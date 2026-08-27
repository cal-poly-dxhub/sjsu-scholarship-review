import * as path from 'node:path';
import { CfnOutput, Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpUserPoolAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';
import type { EnvStackProps } from './env';

/** So the Vite dev server can sign in against the same pool. Matches `vite.config.ts`. */
const DEV_SERVER_ORIGIN = 'http://localhost:3000';

/**
 * The front door: sign-in, the site bucket, the CloudFront distribution, and the HTTP API.
 *
 * The user pool is here rather than in a stack of its own because the app client's callback
 * URL is the CloudFront domain and the JWT authorizer needs the client. In one stack
 * CloudFormation orders that itself; split in two it is a two-pass deploy.
 */
export class EdgeStack extends Stack {
  readonly userPool: cognito.UserPool;
  readonly userPoolClient: cognito.UserPoolClient;
  readonly siteBucket: s3.Bucket;
  readonly distribution: cloudfront.Distribution;
  readonly api: apigwv2.HttpApi;
  readonly authorizer: HttpUserPoolAuthorizer;

  constructor(scope: Construct, id: string, props: EnvStackProps) {
    super(scope, id, props);

    // Accounts are made by an admin. There is no public sign-up, so nobody who finds the URL
    // can give themselves applicant data. Having an account is the whole of authorization:
    // no groups, no extra scopes, and no role claim anyone reads.
    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: `${props.envName}-scholarship-reviewers`,
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: { email: { required: true, mutable: false } },
      userInvitation: {
        emailSubject: 'Your SJSU scholarship review account',
        emailBody:
          'An account has been created for you. Sign in as {username} with the temporary ' +
          'password {####}. You will be asked to set your own password.',
      },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      // Accounts are created by hand, so losing the pool means losing every reviewer.
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const hostedUi = this.userPool.addDomain('HostedUiDomain', {
      cognitoDomain: { domainPrefix: `${props.envName}-sjsu-scholarship-${this.account}` },
    });

    // Replaceable: the build is uploaded again on every deploy, so there is nothing here to
    // keep. Unlike the environment bucket, which carries RETAIN.
    this.siteBucket = new s3.Bucket(this, 'SiteBucket', {
      bucketName: `${props.envName}-sjsu-scholarship-site-${this.account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const placeholder = new lambda.Function(this, 'ApiPlaceholder', {
      functionName: `${props.envName}-api-placeholder`,
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      timeout: Duration.seconds(5),
      description: 'Answers 501 until phase 2 defines the route contract. Reads nothing.',
      code: lambda.Code.fromInline(
        [
          'exports.handler = async () => ({',
          '  statusCode: 501,',
          "  headers: { 'content-type': 'text/plain' },",
          "  body: 'The API is not wired up yet.',",
          '});',
        ].join('\n'),
      ),
    });

    // No CORS configuration anywhere: the app and the API share one origin, so there is
    // nothing to allow and no preflight to answer. Its one route is added below, once the
    // app client the authorizer checks against exists.
    this.api = new apigwv2.HttpApi(this, 'HttpApi', {
      apiName: `${props.envName}-scholarship-api`,
    });

    const apiLogs = new logs.LogGroup(this, 'ApiAccessLogs', {
      logGroupName: `/aws/apigateway/${props.envName}-scholarship-api`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // A rejected call has to be findable: path, method, status, and the reason the token check
    // failed. Nothing else — no Authorization header, no request body, no claim about the
    // caller or an applicant, because an access log is the one place those leak by default.
    const apiStage = this.api.defaultStage?.node.defaultChild as apigwv2.CfnStage;
    apiStage.accessLogSettings = {
      destinationArn: apiLogs.logGroupArn,
      format: JSON.stringify({
        requestId: '$context.requestId',
        requestTime: '$context.requestTime',
        method: '$context.httpMethod',
        path: '$context.path',
        status: '$context.status',
        // Empty on a call that passed the check; the reason it failed otherwise.
        authError: '$context.authorizer.error',
        error: '$context.error.message',
      }),
    };

    const apiOrigin = new origins.HttpOrigin(
      `${this.api.apiId}.execute-api.${this.region}.amazonaws.com`,
      { protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY },
    );

    // The code is a file so a test can run the same source that is deployed.
    const spaRewrite = new cloudfront.Function(this, 'SpaRewrite', {
      functionName: `${props.envName}-spa-rewrite`,
      comment: 'Serve the app shell for in-app routes',
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      code: cloudfront.FunctionCode.fromFile({
        filePath: path.join(__dirname, 'spa-rewrite.js'),
      }),
    });

    const siteOrigin = origins.S3BucketOrigin.withOriginAccessControl(this.siteBucket);

    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: `${props.envName} scholarship review`,
      defaultRootObject: 'index.html',
      // The app shell is not cached, so the next load after a deploy is the new build.
      defaultBehavior: {
        origin: siteOrigin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        functionAssociations: [
          { function: spaRewrite, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST },
        ],
      },
      additionalBehaviors: {
        // Vite fingerprints these filenames, so a new build is a new name, not new contents.
        '/assets/*': {
          origin: siteOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        },
        '/api/*': {
          origin: apiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          // Forwards Authorization and drops the viewer's Host, which the API origin must not
          // see or it will reject the request.
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
      },
      // No minimumProtocolVersion: without a custom certificate CloudFront pins its own
      // security policy and setting it would only look like a control that is not there.
    });

    const siteUrl = `https://${this.distribution.domainName}`;

    // Authorization code flow with PKCE and no client secret: the browser holds no secret it
    // cannot keep, and no token ever rides in a URL fragment.
    this.userPoolClient = this.userPool.addClient('WebClient', {
      userPoolClientName: `${props.envName}-web`,
      generateSecret: false,
      authFlows: { userSrp: true },
      oAuth: {
        flows: { authorizationCodeGrant: true, implicitCodeGrant: false },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
        callbackUrls: [siteUrl, DEV_SERVER_ORIGIN],
        logoutUrls: [siteUrl, DEV_SERVER_ORIGIN],
      },
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(30),
      preventUserExistenceErrors: true,
    });

    // The token is checked here, before anything behind it runs. No handler in this repo
    // verifies a signature, an issuer, an audience, or an expiry. The routes in ComputeStack
    // reuse this one, so every route is checked the same way.
    this.authorizer = new HttpUserPoolAuthorizer('JwtAuthorizer', this.userPool, {
      userPoolClients: [this.userPoolClient],
    });

    new apigwv2.HttpRoute(this, 'DefaultRoute', {
      httpApi: this.api,
      routeKey: apigwv2.HttpRouteKey.DEFAULT,
      integration: new HttpLambdaIntegration('Placeholder', placeholder),
      authorizer: this.authorizer,
    });

    new CfnOutput(this, 'SiteUrl', { value: siteUrl });
    new CfnOutput(this, 'SiteBucketName', { value: this.siteBucket.bucketName });
    new CfnOutput(this, 'DistributionId', { value: this.distribution.distributionId });
    new CfnOutput(this, 'UserPoolId', { value: this.userPool.userPoolId });
    new CfnOutput(this, 'UserPoolClientId', { value: this.userPoolClient.userPoolClientId });
    new CfnOutput(this, 'SignInDomain', { value: hostedUi.baseUrl().replace('https://', '') });
  }
}
