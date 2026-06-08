// Single CDK stack for the Agent Workflow Engine platform.
//
// Resources:
//   - VPC (2 AZs, public + private + isolated subnets)
//   - RDS Postgres (pgvector, t4g.micro, isolated subnet)
//   - ECS Fargate service (Workflow Engine, private subnet, internal ALB)
//   - Lambda function (Backend API, bundled from TypeScript)
//   - API Gateway HTTP API (public, routes to Lambda)
//
// In production you'd split this into 3 stacks. For the MVP, a single
// stack avoids cross-stack cyclic dependency issues with security
// groups and VPC references.

import * as path from "node:path";
import { fileURLToPath } from "node:url";

import * as cdk from "aws-cdk-lib";
import * as apigateway from "aws-cdk-lib/aws-apigatewayv2";
import * as integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecs_patterns from "aws-cdk-lib/aws-ecs-patterns";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambda_nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as rds from "aws-cdk-lib/aws-rds";
import type { Construct } from "constructs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVICES = path.resolve(HERE, "../../services");

export class AgentEngineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ─── VPC ──────────────────────────────────────────────────────
    const vpc = new ec2.Vpc(this, "Vpc", {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        { name: "public", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: "private", subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
        { name: "isolated", subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    });

    // ─── Security Groups ──────────────────────────────────────────
    const dbSg = new ec2.SecurityGroup(this, "DbSg", {
      vpc,
      description: "RDS Postgres",
      allowAllOutbound: false,
    });
    const engineSg = new ec2.SecurityGroup(this, "EngineSg", {
      vpc,
      description: "Workflow Engine Fargate",
      allowAllOutbound: true,
    });
    dbSg.addIngressRule(engineSg, ec2.Port.tcp(5432), "Allow Engine to DB on port 5432");

    // ─── RDS Postgres ─────────────────────────────────────────────
    const db = new rds.DatabaseInstance(this, "Postgres", {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.of("16.14", "16"),
      }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [dbSg],
      databaseName: "agentengine",
      credentials: rds.Credentials.fromGeneratedSecret("postgres", {
        secretName: "agent-engine/db-credentials",
      }),
      multiAz: false,
      allocatedStorage: 20,
      maxAllocatedStorage: 50,
      storageEncrypted: true,
      deletionProtection: false,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      backupRetention: cdk.Duration.days(7),
    });

    // ─── ECS Fargate: Workflow Engine ─────────────────────────────
    const cluster = new ecs.Cluster(this, "Cluster", { vpc });

    const taskDef = new ecs.FargateTaskDefinition(this, "EngineTaskDef", {
      memoryLimitMiB: 1024,
      cpu: 512,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.ARM64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });

    db.secret!.grantRead(taskDef.taskRole);
    taskDef.taskRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonBedrockFullAccess"),
    );

    // Grant ECR pull access for the pre-built image
    taskDef.addToExecutionRolePolicy(new iam.PolicyStatement({
      actions: ["ecr:GetDownloadUrlForLayer", "ecr:BatchGetImage", "ecr:GetAuthorizationToken", "ecr:BatchCheckLayerAvailability"],
      resources: ["*"],
    }));

    const engineLogGroup = new logs.LogGroup(this, "EngineLogGroup", {
      logGroupName: "/ecs/agent-engine/workflow-engine",
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const engineImageUri = process.env.ENGINE_IMAGE_URI ?? "";
    if (!engineImageUri) {
      throw new Error(
        "ENGINE_IMAGE_URI not set. Run ./infra/scripts/build-and-push.sh first, then set ENGINE_IMAGE_URI in infra/.env",
      );
    }

    const container = taskDef.addContainer("engine", {
      image: ecs.ContainerImage.fromRegistry(engineImageUri),
      logging: ecs.LogDrivers.awsLogs({ logGroup: engineLogGroup, streamPrefix: "engine" }),
      environment: {
        PORT: "4000",
        LOG_LEVEL: "info",
        SERVICE_NAME: "workflow-engine",
        LLM_PROVIDER: "bedrock",
        AWS_REGION: cdk.Stack.of(this).region,
        DB_HOST: db.dbInstanceEndpointAddress,
        DB_PORT: db.dbInstanceEndpointPort,
        DB_NAME: "agentengine",
      },
      secrets: {
        DB_SECRET_ARN: ecs.Secret.fromSecretsManager(db.secret!),
      },
      healthCheck: {
        command: ["CMD-SHELL", "curl -f http://localhost:4000/health || exit 1"],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
      },
    });
    container.addPortMappings({ containerPort: 4000 });

    const fargateService = new ecs_patterns.ApplicationLoadBalancedFargateService(
      this,
      "EngineService",
      {
        cluster,
        taskDefinition: taskDef,
        desiredCount: 1,
        securityGroups: [engineSg],
        assignPublicIp: false,
        taskSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        publicLoadBalancer: false,
        listenerPort: 80,
      },
    );

    fargateService.targetGroup.configureHealthCheck({
      path: "/health",
      port: "4000",
      healthyHttpCodes: "200",
      interval: cdk.Duration.seconds(30),
      timeout: cdk.Duration.seconds(10),
    });

    const scaling = fargateService.service.autoScaleTaskCount({ minCapacity: 1, maxCapacity: 4 });
    scaling.scaleOnCpuUtilization("CpuScaling", {
      targetUtilizationPercent: 70,
      scaleInCooldown: cdk.Duration.seconds(60),
      scaleOutCooldown: cdk.Duration.seconds(30),
    });

    const engineUrl = `http://${fargateService.loadBalancer.loadBalancerDnsName}`;

    // ─── Lambda: Backend API ──────────────────────────────────────
    const apiLogGroup = new logs.LogGroup(this, "ApiLogGroup", {
      logGroupName: "/aws/lambda/agent-engine-backend-api",
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const fn = new lambda_nodejs.NodejsFunction(this, "ApiHandler", {
      entry: path.join(SERVICES, "backend-api/src/lambda.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      environment: {
        WORKFLOW_ENGINE_URL: engineUrl,
        LOG_LEVEL: "info",
        SERVICE_NAME: "backend-api",
        NODE_OPTIONS: "--enable-source-maps",
      },
      bundling: {
        format: lambda_nodejs.OutputFormat.ESM,
        minify: true,
        sourceMap: true,
        target: "node20",
        mainFields: ["module", "main"],
        banner: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
      },
      logGroup: apiLogGroup,
    });

    // Allow Lambda to reach the internal ALB
    engineSg.addIngressRule(fn.connections.securityGroups[0]!, ec2.Port.tcp(80), "Allow Lambda to Engine ALB on port 80");

    // ─── API Gateway HTTP API ─────────────────────────────────────
    const httpApi = new apigateway.HttpApi(this, "HttpApi", {
      apiName: "agent-engine-api",
      corsPreflight: {
        allowOrigins: ["*"],
        allowMethods: [
          apigateway.CorsHttpMethod.GET,
          apigateway.CorsHttpMethod.POST,
          apigateway.CorsHttpMethod.PUT,
          apigateway.CorsHttpMethod.DELETE,
          apigateway.CorsHttpMethod.OPTIONS,
        ],
        allowHeaders: ["content-type", "x-request-id", "authorization"],
      },
    });

    httpApi.addRoutes({
      path: "/{proxy+}",
      methods: [apigateway.HttpMethod.ANY],
      integration: new integrations.HttpLambdaIntegration("LambdaIntegration", fn),
    });

    // ─── Outputs ──────────────────────────────────────────────────
    new cdk.CfnOutput(this, "ApiUrl", { value: httpApi.apiEndpoint });
    new cdk.CfnOutput(this, "EngineUrl", { value: engineUrl });
    new cdk.CfnOutput(this, "DbEndpoint", { value: db.dbInstanceEndpointAddress });
    new cdk.CfnOutput(this, "DbSecretArn", { value: db.secret!.secretArn });
  }
}
