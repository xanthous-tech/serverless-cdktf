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
  ApiGatewayGatewayResponse,
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

    //TODO:updata data.
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
    console.log(`REF: ${JSON.stringify(this.refMaps)}`);
    if (!Object.prototype.hasOwnProperty.call(this.refMaps, ref)) {
      const ins = this.handleRef({ Ref: ref });
      return ins.getStringAttribute('id');
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
        this.addLambdaVersion(key, cfResource);
        break;
      default:
        throw new Error(`unsupported type ${cfResource.Type}`);
    }
  }

  public convertAPiGatewayAuthorizer(key: string, cfTemplate: any): void {
    console.log('converting api gateway authorizer', cfTemplate);

    const cfProperties = cfTemplate.Properties;
    const restapi = this.handleRef<ApiGatewayRestApi>(cfProperties.RestApiId);

    this.tfResources[key] = new ApiGatewayAuthorizer(this, key, {
      authorizerResultTtlInSeconds: cfProperties.AuthorizerResultTtlInSeconds,
      identitySource: cfProperties.IdentitySource,
      name: cfProperties.Name,
      restApiId: restapi.id!,
      authorizerUri: this.handleResources(cfProperties.AuthorizerUri),
      type: cfProperties.Type,
    });
  }

  public convertAPiGatewayDeployment(key: string, cfTemplate: any): void {
    console.log('converting apigateway deployment', cfTemplate);

    const cfProperties = cfTemplate.Properties;
    this.tfResources[key] = new ApiGatewayDeployment(this, key, {
      restApiId: this.handleResources(cfProperties.RestApiId),
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
      sourceArn: this.handleResources(cfProperties.SourceArn),
    });
  }

  public convertAPiGatewayMethod(key: string, cfTemplate: any): void {
    console.log(`-----------------------------`);
    console.log('converting api gateway method', key, cfTemplate);
    console.log(`-----------------------------`);

    const cfProperties = cfTemplate.Properties;
    console.log(cfProperties);

    const apiGatewaymethod = new ApiGatewayMethod(this, key, {
      httpMethod: cfProperties.HttpMethod,
      requestParameters: cfProperties.RequestParameters,
      resourceId: this.handleResources(cfProperties.ResourceId),
      restApiId: this.handleResources(cfProperties.RestApiId),

      apiKeyRequired: cfProperties.ApiKeyRequired,
      authorization: cfProperties.AuthorizationType,

      authorizerId: this.handleResources(cfProperties.AuthorizerId),
    });

    console.log(apiGatewaymethod);

    this.tfResources[key] = apiGatewaymethod;

    const response = cfProperties.Integration;

    //TODO:fix this.  not completely match.
    //TODO: create response method https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/api_gateway_integration_response
    // new ApiGatewayGatewayResponse(this, `${key}_response`, {
    //   restApiId: apiGatewaymethod.id!,
    //   responseType: response.Type,
    // });
  }

  public convertApiGatewayResource(key: string, cfTemplate: any): void {
    console.log('converting api gateway resource', cfTemplate);

    const cfProperties = cfTemplate.Properties;
    this.tfResources[key] = new ApiGatewayResource(this, key, {
      parentId: this.handleResources(cfProperties.ParentId),
      pathPart: cfProperties.PathPart,
      restApiId: this.handleResources(cfProperties.RestApiId),
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
    console.log('converting cloudFront distribution', JSON.stringify(cfTemplate));

    const cfProperties = cfTemplate.Properties;
    const distributionConfig = cfProperties.DistributionConfig;
    const origins: any[] = cfProperties.DistributionConfig.Origins;

    this.tfResources[key] = new CloudfrontDistribution(this, key, {
      origin: origins.map((origin) => ({
        originId: origin.Id,
        domainName: this.handleResources(origin.DomainName),
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
          viewerProtocolPolicy: '',
        },
      ],
      cacheBehavior: distributionConfig.CacheBehaviors.map(
        (cache: {
          AllowedMethods: any;
          CachedMethods: any;
          ForwardedValues: { QueryString: any; Headers: any; Cookies: { Forward: any } };
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
                  forward: cache.ForwardedValues.Cookies.Forward,
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

    if (bucketProperties.BucketEncryption) {
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
    } else {
      this.tfResources[key] = new S3Bucket(this, key, {});
    }
  }

  public convertS3BucketPolicy(key: string, cfTemplate: any): void {
    console.log('converting s3 bucket policy', JSON.stringify(cfTemplate));
    const policyProperties = cfTemplate.Properties;
    let s3BucketName;
    if (typeof policyProperties.Bucket === 'string') {
      s3BucketName = policyProperties.Bucket;
    } else {
      const bucketRef = policyProperties.Bucket as RefObject;
      const s3Bucket = this.handleRef<S3Bucket>(bucketRef);
      s3BucketName = s3Bucket.bucket;
    }

    const statement = policyProperties.PolicyDocument.Statement[0];
    const condition = statement.Condition;

    let s3Policy;
    //check condition keys
    if (condition) {
      console.log(`condition is ${JSON.stringify(condition)}`);
      const [key] = Object.keys(condition);
      const [conditionVariable] = Object.keys(condition[key]);

      s3Policy = new DataAwsIamPolicyDocument(this, `${key}Document`, {
        statement: [
          {
            actions: [statement.Action],
            effect: statement.Effect,
            principals: [
              {
                identifiers: [statement.Principal],
                type: 'AWS',
              },
            ],
            // TODO: handle Fn:Join
            // resources: [`arn:aws:s3:::${s3Bucket.bucket}/*`],
            resources: statement.Resource.map((resource: any) => this.handleResources(resource)),
            condition: [
              {
                test: key,
                variable: conditionVariable,
                values: [condition[key][conditionVariable].toString()],
              },
            ],
          },
        ],
      });
    } else {
      s3Policy = new DataAwsIamPolicyDocument(this, `${key}Document`, {
        statement: [
          {
            actions: [statement.Action],
            effect: statement.Effect,
            principals: [
              {
                identifiers: [statement.Principal],
                type: 'AWS',
              },
            ],
            resources: [this.handleResources(statement.Resource)],
            // TODO: handle Fn:Join
            // resources: [`arn:aws:s3:::${s3Bucket.bucket}/*`],
          },
        ],
      });
    }

    this.tfResources[key] = new S3BucketPolicy(this, key, {
      bucket: s3BucketName,
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
    console.log(`converting iam role ${JSON.stringify(cfTemplate)}`);
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
              //TODO: use variables
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

    this.tfResources[key] = role;

    if (policies) {
      const policyStatement = policies[0].PolicyDocument.Statement.map(
        (statement: { Action: any; Effect: any; Principal: any; Resource: any[] }) => ({
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
        }),
      );

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
    }
  }

  public convertLambdaFunction(key: string, cfTemplate: any): void {
    console.log(`converting lambda function ${JSON.stringify(cfTemplate)}`);
    const lambdaProperties = cfTemplate.Properties;

    console.log(`bucket is ${lambdaProperties.Code.S3Bucket}`);
    const s3Bucket = this.handleRef<S3Bucket>(lambdaProperties.Code.S3Bucket);

    const role = this.handleResources(lambdaProperties.Role);

    this.tfResources[key] = new LambdaFunction(this, key, {
      s3Bucket: s3Bucket.bucket,
      s3Key: lambdaProperties.Code.S3Key,
      functionName: lambdaProperties.FunctionName,
      handler: lambdaProperties.Handler,

      role: role,
      runtime: lambdaProperties.Runtime,
      timeout: lambdaProperties.Timeout,
    });
  }

  public addLambdaVersion(key: string, cfTemplate: any) {
    const versionProperties = cfTemplate.Properties;

    const lambda = this.handleRef<LambdaFunction>({ Ref: versionProperties.FunctionName });
    lambda.publish = true;
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

  public handleResources(resources: any): any {
    console.log(`handling resources ${JSON.stringify(resources)}`);
    if (typeof resources === 'string' || typeof resources === 'undefined') {
      return resources;
    }
    const [key] = Object.keys(resources);

    switch (key) {
      case 'Fn::Join':
        return this.convertFnJoin(resources[key]);
      case 'Fn::Sub':
        return this.convertFnSub(resources[key]);
      case 'Ref':
        return this.getRefMap(resources[key]);
      case 'Fn::GetAtt':
        return this.convertGetAtt(resources[key]);
      case 'Fn::Split':
        return this.convertFnSplit(resources[key]);
      case 'Fn::Select':
        return this.convertFnSelect(resources[key]);
      default:
        throw new Error(`cannot find key ${key}`);
    }
  }

  public convertGetAtt(data: any[]): string {
    console.log(`data is ${JSON.stringify(data)}`);
    const ref = this.handleRef({ Ref: data[0] });

    const camelToSnakeCase = (str: string) =>
      str[0].toLowerCase() + str.slice(1, str.length).replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

    console.log(`original att is ${data[1]}`);

    const property = camelToSnakeCase(data[1] as string);

    //Exceptions.
    if (data[1] === 'WebsiteURL') {
      return ref.getStringAttribute('website_endpoint');
    }

    //in most cases property are lowercase in terraform.
    return ref.getStringAttribute(property);
  }

  public convertFnSelect(data: any[]): string {
    const index = data[0] as number;

    if (!Array.isArray(data[1])) {
      return this.handleResources(data[1])[index];
    }

    return data[1][index];
  }

  public convertFnSplit(data: any[]): any {
    const separator = data[0];
    if (typeof data[1] !== 'string') {
      return this.handleResources(data[1]).split(separator);
    }
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
        elements.push(this.handleResources(others[i]));
      }
    }
    const result = elements.join(separator);
    console.log(`join result is ${result}`);
    return result;
  }
}
