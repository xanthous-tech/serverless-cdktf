import Serverless from 'serverless';
import { TerraformStack, TerraformOutput, TerraformResource, S3Backend } from 'cdktf';
import { Construct } from 'constructs';
import {
  AwsProvider,
  S3Bucket,
  DataAwsIamPolicyDocument,
  S3BucketPolicy,
  CloudwatchLogGroup,
  IamRole,
  IamRolePolicy,
  LambdaFunction,
  DataAwsVpc,
  CloudfrontDistribution,
  ApiGatewayRestApi,
  ApiGatewayResource,
  ApiGatewayMethod,
  LambdaPermission,
  ApiGatewayDeployment,
  ApiGatewayAuthorizer,
} from '../.gen/providers/aws';

interface RefObject {
  Ref?: string;
}

interface GetAttObject {
  'Fn::GetAtt'?: string;
}

export class Cf2Tf extends TerraformStack {
  public cfResources: any;
  public cfOutputs: any;

  public tfResources: {
    [key: string]: TerraformResource;
  };

  public tfOutputs: {
    [key: string]: TerraformOutput;
  };

  public refMaps: {
    [key: string]: string;
  };

  public resourceRefTypeMap: {
    [key: string]: string;
  };

  constructor(scope: Construct, name: string, public serverless: Serverless, cfTemplate: any) {
    super(scope, name);

    this.cfResources = cfTemplate.Resources;
    this.cfOutputs = cfTemplate.Outputs;
    this.tfResources = {};
    this.tfOutputs = {};
    this.resourceRefTypeMap = {};

    const provider = new AwsProvider(this, 'provider', {
      region: serverless.service.provider.region,
      profile: (serverless.service.provider as any).profile,
    });

    const vpc = new DataAwsVpc(this, 'default', {});

    const [, partition, , region, accountId] = vpc.arn.split(':');

    this.refMaps = {
      'AWS::Region': region,
      'AWS::Partition': partition,
      'AWS::AccountId': accountId,
    };

    new S3Backend(this, {
      region: serverless.service.provider.region,
      profile: (serverless.service.provider as any).profile,
      // TODO: make bucket configurable
      bucket: 'asu-terraform-state',
      key: name,
    });

    this.convertCfResources();
    this.convertCfOutputs();
  }

  private convertCfOutputs(): void {
    for (const key in this.cfOutputs) {
      if (!Object.prototype.hasOwnProperty.call(this.cfOutputs, key)) {
        continue;
      }

      const cfOutput = this.cfOutputs[key];
      this.tfOutputs[key] = new TerraformOutput(this, key, {
        value: this.handleOutputRef(cfOutput.Value),
      });
    }
  }

  public convertCfResources(): void {
    for (const key in this.cfResources) {
      if (!Object.prototype.hasOwnProperty.call(this.cfResources, key)) {
        continue;
      }

      const cfResource = this.cfResources[key];
      this.convertCfResource(key, cfResource);
    }
  }

  private getRefMap(ref: string): string {
    if (!Object.prototype.hasOwnProperty.call(this.refMaps, ref)) {
      throw new Error(`Can not find property ${ref}`);
    }

    return this.refMaps[ref];
  }

  public convertCfResource(key: string, cfResource: any): void {
    if (this.tfResources[key]) {
      return;
    }

    //This is for versioning in lambda.
    this.resourceRefTypeMap[key] = cfResource.Type;

    switch (cfResource.Type) {
      case 'AWS::S3::Bucket':
        this.convertS3Bucket(key, cfResource);
        break;
      case 'AWS::S3::BucketPolicy':
        this.convertS3BucketPolicy(key, cfResource);
        break;
      case 'AWS::Logs::LogGroup':
        this.convertCloudwatchLogGroup(key, cfResource);
        break;
      case 'AWS::IAM::Role':
        this.convertIamRole(key, cfResource);
        break;
      case 'AWS::Lambda::Function':
        this.convertLambdaFunction(key, cfResource);
        break;
      case 'AWS::CloudFront::Distribution':
        this.convertCloudFrontDistribution(key, cfResource);
        break;
      case 'AWS::ApiGateway::RestApi':
        this.convertAPiGatewayRestApi(key, cfResource);
        break;
      case 'AWS::ApiGateway::Resource':
        this.convertApiGatewayResource(key, cfResource);
        break;
      case 'AWS::ApiGateway::Method':
        this.convertAPiGatewayMethod(key, cfResource);
        break;
      case 'AWS::ApiGateway::Authorizer':
        this.convertAPiGatewayAuthorizer(key, cfResource);
        break;
      case 'AWS::ApiGateway::Deployment':
        this.convertAPiGatewayDeployment(key, cfResource);
        break;
      case 'AWS::Lambda::Permission':
        this.convertLambdaPermission(key, cfResource);
        break;
      case 'AWS::Lambda::Version':
        //TODO: fix this.
        // return this.convertNoOpFunction(key, cfResource);
        this.addLambdaVersion(key, cfResource);
        break;
      default:
        throw new Error(`unsupported type ${cfResource.Type}`);
    }
  }

  public convertAPiGatewayAuthorizer(key: string, cfTemplate: any): void {
    console.log('converting api gateway authorizer', cfTemplate);

    const cfProperties = cfTemplate.Properties;
    this.tfResources[key] = new ApiGatewayAuthorizer(this, key, {
      authorizerResultTtlInSeconds: cfProperties.AuthorizerResultTtlInSeconds,
      identitySource: cfProperties.IdentitySource,
      name: cfProperties.Name,
      //TODO: handle ref for rest api id.
      restApiId: cfProperties.RestApiId,
      //TODO: handle the ref
      authorizerUri: cfProperties.AuthorizerUri,
      type: cfProperties.Type,
    });
  }

  public convertAPiGatewayDeployment(key: string, cfTemplate: any): void {
    console.log('converting apigateway deployment', cfTemplate);

    const cfProperties = cfTemplate.Properties;
    this.tfResources[key] = new ApiGatewayDeployment(this, key, {
      //TODO: rest api from ref.
      restApiId: '',
      stageName: cfProperties.StageName,
    });
  }

  public convertLambdaPermission(key: string, cfTemplate: any): void {
    console.log('converting lambda permission', cfTemplate);

    const cfProperties = cfTemplate.Properties;
    this.tfResources[key] = new LambdaPermission(this, key, {
      functionName: '',
      action: cfProperties.Action,
      principal: cfProperties.Principal,
      //TODO: source arn needs to handle Fn::Join.
      sourceArn: cfProperties.SourceArn,
    });
  }

  public convertAPiGatewayMethod(key: string, cfTemplate: any): void {
    console.log('converting api gateway method', cfTemplate);

    const cfProperties = cfTemplate.Properties;
    this.tfResources[key] = new ApiGatewayMethod(this, key, {
      httpMethod: cfProperties.HttpMethod,
      requestParameters: cfProperties.RequestParameters,
      //TODO: Handle resourceId ref
      resourceId: '',
      //TODO: Handle resourceId ref
      restApiId: '',

      apiKeyRequired: cfProperties.ApiKeyRequired,
      authorization: cfProperties.AuthorizationType,

      //TODO: fix this id (ref)
      authorizerId: '',
    });

    //TODO: create response method https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/api_gateway_integration_response
  }

  //TODO: fix the ref stuff.
  public convertApiGatewayResource(key: string, cfTemplate: any): void {
    console.log('converting api gateway resource', cfTemplate);

    const cfProperties = cfTemplate.Properties;
    this.tfResources[key] = new ApiGatewayResource(this, key, {
      //TODO: handle the ref stuf.
      parentId: '',
      pathPart: cfProperties.PathPart,
      restApiId: '',
    });
  }

  public convertAPiGatewayRestApi(key: string, cfTemplate: any): void {
    console.log('converting apiKeyway RestApi', cfTemplate);

    const cfProperties = cfTemplate.Properties;
    this.tfResources[key] = new ApiGatewayRestApi(this, key, {
      name: cfProperties.Name,
      endpointConfiguration: [
        {
          types: cfProperties.EndpointConfiguration.Types,
        },
      ],
      policy: cfProperties.Policy,
    });
  }

  public convertCloudFrontDistribution(key: string, cfTemplate: any): void {
    console.log('converting cloudFront', cfTemplate);

    const cfProperties = cfTemplate.Properties;
    const distributionConfig = cfProperties.DistributionConfig;
    const origins: any[] = cfProperties.DistributionConfig.Origins;

    this.tfResources[key] = new CloudfrontDistribution(this, key, {
      origin: origins.map((origin) => ({
        originId: origin.Id,
        //TODO: domainName contains Fn::Select, Fn::Split, Fn::GetAtt
        domainName: 'hello-world',

        //TODO: this.
        // s3OriginConfig
      })),
      enabled: distributionConfig.Enabled,
      httpVersion: distributionConfig.HttpVersion,
      comment: distributionConfig.Comment,
      aliases: distributionConfig.Aliases,
      priceClass: distributionConfig.PriceClass,
      defaultRootObject: distributionConfig.DefaultRootObject,
      defaultCacheBehavior: [
        {
          allowedMethods: distributionConfig.DefaultCacheBehavior.AllowedMethods,
          //TODO: not sure. cannot find cachedMethods.
          cachedMethods: [],
          targetOriginId: distributionConfig.DefaultCacheBehavior.TargetOriginId,
          compress: distributionConfig.DefaultCacheBehavior.Compress,
          forwardedValues: [
            {
              queryString: distributionConfig.DefaultCacheBehavior.ForwardedValues.QueryString,
              cookies: [
                {
                  forward: distributionConfig.DefaultCacheBehavior.ForwardedValues.Cookies.Forward,
                },
              ],
            },
          ],
          viewerProtocolPolicy: distributionConfig.distributionConfig.ViewerProtocolPolicy,
        },
      ],
      cacheBehavior: distributionConfig.CacheBehaviors.map(
        (cache: {
          AllowedMethods: any;
          CachedMethods: any;
          ForwardedValues: { QueryString: any; Headers: any; Cookie: { Forward: any } };
          MinTTL: string;
          maxTtl: string;
          TargetOriginId: any;
          ViewerProtocolPolicy: any;
          PathPattern: any;
        }) => ({
          allowedMethods: cache.AllowedMethods,
          cachedMethods: cache.CachedMethods,
          forwardedValues: [
            {
              queryString: cache.ForwardedValues.QueryString,
              headers: cache.ForwardedValues.Headers,
              cookies: [
                {
                  forward: cache.ForwardedValues.Cookie.Forward,
                },
              ],
            },
          ],
          minTtl: parseInt(cache.MinTTL),
          maxTtl: parseInt(cache.maxTtl),
          targetOriginId: cache.TargetOriginId,
          viewerProtocolPolicy: cache.ViewerProtocolPolicy,
          PathPattern: cache.PathPattern,
        }),
      ),

      viewerCertificate: [
        {
          acmCertificateArn: distributionConfig.ViewerCertificate.AcmCertificateArn,
          sslSupportMethod: distributionConfig.ViewerCertificate.SslSupportMethod,
        },
      ],

      //TODO: don't know what is restrictions.
      restrictions: [],
    });
  }

  public convertS3Bucket(key: string, cfTemplate: any): void {
    console.log('converting s3 bucket', cfTemplate);
    const bucketProperties = cfTemplate.Properties;

    this.tfResources[key] = new S3Bucket(this, key, {
      // TODO: this is not flexible enough to handle the BucketEncryption list
      serverSideEncryptionConfiguration: [
        {
          rule: [
            {
              applyServerSideEncryptionByDefault: [
                {
                  sseAlgorithm: bucketProperties.BucketEncryption.ServerSideEncryptionConfiguration[0].ServerSideEncryptionByDefault.SSEAlgorithm,
                },
              ],
            },
          ],
        },
      ],
    });
  }

  public convertS3BucketPolicy(key: string, cfTemplate: any): void {
    console.log('converting s3 bucket policy', cfTemplate);
    const policyProperties = cfTemplate.Properties;
    const bucketRef = policyProperties.Bucket as RefObject;
    const s3Bucket = this.handleRef<S3Bucket>(bucketRef);

    const statement = policyProperties.PolicyDocument.Statement[0];
    const condition = statement.Condition;
    //check condition keys
    const conditionKey = Object.keys(condition)[0];
    const conditionVariable = Object.keys(condition[conditionKey])[0];

    const s3Policy = new DataAwsIamPolicyDocument(this, `${key}Document`, {
      statement: [
        {
          //TODO: why action here?
          actions: [statement.Action],
          effect: statement.Effect,
          principals: [
            {
              identifiers: [statement.Principal],
              type: 'AWS',
            },
          ],
          // TODO: handle Fn:Join
          resources: [`arn:aws:s3:::${s3Bucket.bucket}/*`],
          condition: [
            {
              test: conditionKey,
              variable: conditionVariable,
              values: [condition[conditionKey][conditionVariable].toString()],
            },
          ],
        },
      ],
    });

    this.tfResources[key] = new S3BucketPolicy(this, key, {
      dependsOn: [s3Bucket],
      bucket: s3Bucket.bucket ?? '',
      policy: s3Policy.json,
    });
  }

  public convertCloudwatchLogGroup(key: string, cfTemplate: any): void {
    const logGroupProperties = cfTemplate.Properties;

    this.tfResources[key] = new CloudwatchLogGroup(this, key, {
      name: logGroupProperties.LogGroupName,
    });
  }

  public convertIamRole(key: string, cfTemplate: any): void {
    const iamRoleProperties = cfTemplate.Properties;

    const assumeRole = iamRoleProperties.AssumeRolePolicyDocument;
    const statement = assumeRole.Statement[0];
    const policies = iamRoleProperties.Policies;

    const assume_role_policy = new DataAwsIamPolicyDocument(this, `${key}_assume_role_policy`, {
      version: assumeRole.Version,
      statement: [
        {
          actions: statement.Action,
          effect: statement.Effect,
          principals: [
            {
              // identifiers: [statement.Principle],
              identifiers: ['*'],
              type: 'AWS',
            },
          ],
        },
      ],
    });

    const role = new IamRole(this, key, {
      assumeRolePolicy: assume_role_policy.json,
      path: iamRoleProperties.Path,
      name: this.handleResources(iamRoleProperties.RoleName),
    });

    const policyStatement = policies[0].PolicyDocument.Statement.map((statement: { Action: any; Effect: any; Principal: any; Resource: any[] }) => ({
      actions: statement.Action,
      effect: statement.Effect,
      principals: [
        {
          // identifiers: [statement.Principal],
          identifiers: ['*'],
          type: 'AWS',
        },
      ],
      resources: statement.Resource.map((resource: any) => this.handleResources(resource)),
    }));

    const iamRolePolicy = new DataAwsIamPolicyDocument(this, `${key}_iam_role_policy_document`, {
      statement: policyStatement,
    });

    //add iam role policy here.
    new IamRolePolicy(this, `${key}_iam_role_policy`, {
      //TODO: fix policies
      name: this.handleResources(policies[0].PolicyName),
      role: role.id ?? '',
      policy: iamRolePolicy.json,
    });

    this.tfResources[key] = role;
  }

  public convertLambdaFunction(key: string, cfTemplate: any): void {
    const lambdaProperties = cfTemplate.Properties;

    console.log(`bucket is ${lambdaProperties.Code.S3Bucket}`);
    const s3Bucket = this.handleRef<S3Bucket>(lambdaProperties.Code.S3Bucket);

    const role = this.handleFnGetAtt<IamRole>(lambdaProperties.Role);

    let versionFlag = false;

    //如果 cf resource's 里面有 version, 那么就 publish
    for (const key in this.cfResources) {
      if (!Object.prototype.hasOwnProperty.call(this.cfResources, key)) {
        continue;
      }

      if (this.cfResources[key].Type === 'AWS::Lambda::Version') {
        versionFlag = true;
      }

      break;
    }

    this.tfResources[key] = new LambdaFunction(this, key, {
      s3Bucket: s3Bucket.bucket,
      s3Key: lambdaProperties.Code.S3Key,
      functionName: lambdaProperties.FunctionName,
      handler: lambdaProperties.Handler,

      role: role.arn,
      runtime: lambdaProperties.Runtime,
      timeout: lambdaProperties.Timeout,

      publish: versionFlag,
    });
  }

  public addLambdaVersion(key: string, cfTemplate: any) {
    const versionProperties = cfTemplate.Properties;

    const lambda = this.handleRef<LambdaFunction>({ Ref: versionProperties.FunctionName });

    //TODO:add handle for versions.
    //This is versioning things.
  }

  public handleFnGetAtt<T extends TerraformResource>(att: GetAttObject): T {
    if (!att['Fn::GetAtt']) {
      throw new Error('cannot find Fn::GetAtt');
    }
    return this.handleRef<T>({ Ref: att['Fn::GetAtt'][0] });
  }

  public handleRef<T extends TerraformResource>({ Ref }: RefObject): T {
    if (!Ref) {
      // is not ref, need to process other things
      throw new Error('it is not a ref object');
    }

    if (!this.tfResources[Ref] && this.cfResources[Ref]) {
      this.convertCfResource(Ref, this.cfResources[Ref]);
    }

    return this.tfResources[Ref] as T;
  }

  public handleOutputRef({ Ref }: RefObject): any {
    if (!Ref) {
      // is not ref, need to process other things
      throw new Error('it is not a ref object');
    }

    if (this.resourceRefTypeMap[Ref] === 'AWS::Lambda::Version') {
      const lambda = this.handleRef<LambdaFunction>({ Ref: this.cfResources[Ref].Properties.FunctionName });
      return lambda;
    }

    const tfResource = this.tfResources[Ref];

    if (!tfResource) {
      throw new Error('cannot find reference');
    }

    // handle each specific ref type

    if (tfResource instanceof S3Bucket) {
      return (tfResource as S3Bucket).bucket;
    }

    throw new Error('unimplemented ref type');
  }

  public handleResources(resources: any): string {
    //Contains Keys Fn::Get
    const fnFunc = ['Fn::Join', 'Fn::Sub', 'Fn::GetAtt'];

    let data = '';

    for (const key in resources) {
      if (fnFunc.includes(key)) {
        switch (key) {
          case 'Fn::Join':
            data = this.convertFnJoin(resources[key]);
            break;
          case 'Fn::Sub':
            data = this.convertFnSub(resources[key]);
            break;
          case 'Fn:Select':
            //TODO: fix this.
            break;
        }
        break;
      }
    }

    return data;
  }

  //TODO: 不完整
  public convertFnSelect(data: any[]): any {
    const index = data[0] as number;
    //TODO: what if data[1] contains other resource??
    return data[1][index];
  }

  public convertFnSplit(data: any[]): any {
    const separator = data[0];
    //TODO: data1 needs to convert to string.
    return data[1].split(separator);
  }

  public convertFnSub(data: string): string {
    const regex = /\$\{([a-zA-Z]+::[a-zA-Z]+)}/g;
    const regexList = data.split(regex);

    return regexList
      .map((rawStr) => {
        if (rawStr.startsWith('AWS::')) {
          return this.getRefMap(rawStr);
        }
        return rawStr;
      })
      .concat()
      .join('');
  }

  public convertFnJoin(data: Array<any>): string {
    const separator = data[0];
    const others = <Array<any>>data[1];
    const elements: Array<string> = [];

    for (let i = 0; i < others.length; i++) {
      if (typeof others[i] === 'string') {
        elements.push(others[i]);
      } else {
        if (Object.prototype.hasOwnProperty.call(others[i], 'Ref')) {
          elements.push(this.refConvert(others[i]));
        } else {
          // TODO:handle other cases.
          console.log(`cannot find ref ${others[i]} for ${JSON.stringify(others)}`);
          throw new Error('Not Ref!');
        }
      }
    }

    return elements.join(separator);
  }

  public refConvert(data: RefObject): string {
    if (!data.Ref) {
      throw new Error('Cannot find Ref!');
    }
    if (Object.prototype.hasOwnProperty.call(this.refMaps, data.Ref)) {
      return this.refMaps[data.Ref];
    } else {
      throw new Error(`Can not find match for ${data.Ref}`);
    }
  }
}
