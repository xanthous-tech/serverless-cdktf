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
} from '../.gen/providers/aws';

interface RefObject {
  Ref?: string;
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

  constructor(scope: Construct, name: string, public serverless: Serverless, cfTemplate: any) {
    super(scope, name);

    this.cfResources = cfTemplate.Resources;
    this.cfOutputs = cfTemplate.Outputs;
    this.tfResources = {};
    this.tfOutputs = {};

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
        value: Cf2Tf.handleOutputRef(this, cfOutput.Value),
      });
    }
  }

  private convertCfResources(): void {
    for (const key in this.cfResources) {
      if (!Object.prototype.hasOwnProperty.call(this.cfResources, key)) {
        continue;
      }

      const cfResource = this.cfResources[key];
      this.tfResources[key] = Cf2Tf.convertCfResource(this, key, cfResource);
    }
  }

  private getRefMap(ref: string): string {
    if (!Object.prototype.hasOwnProperty.call(this.refMaps, ref)) {
      throw new Error(`Can not find property ${ref}`);
    }

    return this.refMaps[ref];
  }

  public static convertCfResource(self: Cf2Tf, key: string, cfResource: any): TerraformResource {
    switch (cfResource.Type) {
      //TODO: here we add resources.
      case 'AWS::S3::Bucket':
        return Cf2Tf.convertS3Bucket(self, key, cfResource);
      case 'AWS::S3::BucketPolicy':
        return Cf2Tf.convertS3BucketPolicy(self, key, cfResource);
      case 'AWS::Logs::LogGroup':
        return Cf2Tf.convertCloudwatchLogGroup(self, key, cfResource);
      case 'AWS::IAM::Role':
        return Cf2Tf.convertIamRole(self, key, cfResource);
      case '"AWS::Lambda::Function':
        return Cf2Tf.convertLambdaFunction(self, key, cfResource);
      default:
        throw new Error(`unsupported type ${cfResource.Type}`);
    }
  }

  public static convertS3Bucket(self: Cf2Tf, key: string, cfTemplate: any): S3Bucket {
    console.log('converting s3 bucket', cfTemplate);
    const bucketProperties = cfTemplate.Properties;

    return new S3Bucket(self, key, {
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

  public static convertS3BucketPolicy(self: Cf2Tf, key: string, cfTemplate: any): S3BucketPolicy {
    console.log('converting s3 bucket policy', cfTemplate);
    const policyProperties = cfTemplate.Properties;
    const bucketRef = policyProperties.Bucket as RefObject;
    const s3Bucket = Cf2Tf.handleRef<S3Bucket>(self, bucketRef);

    const statement = policyProperties.PolicyDocument.Statement[0];
    const condition = statement.Condition;
    //check condition keys
    const conditionKey = Object.keys(condition)[0];
    const conditionVariable = Object.keys(condition[conditionKey])[0];

    const s3Policy = new DataAwsIamPolicyDocument(self, `${key}Document`, {
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

    return new S3BucketPolicy(self, key, {
      dependsOn: [s3Bucket],
      //TODO: ?? instead of ! , why?
      bucket: s3Bucket.bucket ?? '',
      policy: s3Policy.json,
    });
  }

  public static convertCloudwatchLogGroup(self: Cf2Tf, key: string, cfTemplate: any): CloudwatchLogGroup {
    const logGroupProperties = cfTemplate.Properties;

    return new CloudwatchLogGroup(self, key, {
      name: logGroupProperties.LogGroupName,
    });
  }

  public static convertIamRole(self: Cf2Tf, key: string, cfTemplate: any): IamRole {
    const iamRoleProperties = cfTemplate.Properties;

    const assumeRole = iamRoleProperties.AssumeRolePolicyDocument;
    const statement = assumeRole.Statement[0];
    const policies = iamRoleProperties.Policies;

    const assume_role_policy = new DataAwsIamPolicyDocument(self, `${key}_assume_role_policy`, {
      version: assumeRole.Version,
      statement: [
        {
          actions: [statement.Action],
          effect: statement.Effect,
          principals: [
            {
              identifiers: [statement.Principle],
              type: 'AWS',
            },
          ],
        },
      ],
    });

    const role = new IamRole(self, key, {
      assumeRolePolicy: assume_role_policy.json,
      path: iamRoleProperties.Path,
      name: Cf2Tf.handleResources(iamRoleProperties.RoleName),
    });

    //TODO: fix policies. (now it only support 1 policy)
    const policyStatement = policies[0].PolicyDocument.Statement.map((statement: { Action: any; Effect: any; Resource: any[] }) => ({
      actions: statement.Action,
      effect: statement.Effect,
      Resource: statement.Resource.map((resource) => Cf2Tf.handleResources(resource)),
    }));

    const iamRolePolicy = new DataAwsIamPolicyDocument(self, `${key}_iam_role_policy_document`, {
      statement: policyStatement,
    });

    //add iam role policy here.
    new IamRolePolicy(self, `${key}_iam_role_policy`, {
      //TODO: fix policies
      name: Cf2Tf.handleResources(policies[0].PolicyName),
      role: role.id ?? '',
      policy: iamRolePolicy.json,
    });

    return role;
  }

  //TODO: implement this.
  public static convertLambdaFunction(self: Cf2Tf, key: string, cfTemplate: any): LambdaFunction {
    const lambdaProperties = cfTemplate.Properties;

    return new LambdaFunction(self, key, {
      //TODO: Ref convert!
      // s3Bucket: lambdaProperties.Code
      s3Bucket: 's3-bucket',
      s3Key: lambdaProperties.Code.S3Key,
      functionName: lambdaProperties.FunctionName,
      handler: lambdaProperties.Handler,

      //TODO: handle Fn::GetAtt
      role: 'myRole',
      runtime: lambdaProperties.MemorySize,
      timeout: lambdaProperties.Timeout,

      //TODO: 如果有 AWS::Lambda::Version
      publish: true,
    });
  }

  public static handleRef<T extends TerraformResource>(self: Cf2Tf, { Ref }: RefObject): T {
    if (!Ref) {
      // is not ref, need to process other things
      throw new Error('it is not a ref object');
    }

    if (!self.tfResources[Ref] && self.cfResources[Ref]) {
      self.tfResources[Ref] = Cf2Tf.convertCfResource(self, Ref, self.cfResources[Ref]);
    }

    return self.tfResources[Ref] as T;
  }

  public static handleOutputRef(self: Cf2Tf, { Ref }: RefObject): any {
    if (!Ref) {
      // is not ref, need to process other things
      throw new Error('it is not a ref object');
    }

    const tfResource = self.tfResources[Ref];

    if (!tfResource) {
      throw new Error('cannot find reference');
    }

    // handle each specific ref type

    if (tfResource instanceof S3Bucket) {
      return (tfResource as S3Bucket).bucket;
    }

    throw new Error('unimplemented ref type');
  }

  //TODO: handle Fn:join stuff
  public static handleResources(resources: any): string {
    //Contains Keys Fn::Get
    const fnFunc = ['Fn::Join', 'Fn::Sub'];

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
        }
        break;
      }
    }

    return data;
  }

  public convertFnSub(data: string): string {
    const regex = /\$\{([a-zA-Z]+::[a-zA-Z]+)}/g;
    const regexList = data.split(regex);

    regexList
      .map((rawStr) => {
        //TODO: start with ref,handle it.
        if (rawStr.startsWith('AWS::')) {
          return this.getRefMap(rawStr);
        }

        return rawStr;
      })
      .concat()
      .join('');
  }

  public static convertFnJoin(data: Array<any>): string {
    const separator = data[0];
    const others = <Array<any>>data.splice(1);
    const elements: Array<string> = [];
    for (let i = 0; i < others.length; i++) {
      if (typeof others[i] === 'string') {
        elements.push(others[i]);
      } else {
        if (Object.prototype.hasOwnProperty.call(others[i], 'Ref')) {
          //TODO: fix this.k
          elements.push(this.refConvert(others[i]));
        } else {
          // TODO:handle other cases.
          throw new Error('Not Ref! ');
        }
      }
    }

    return elements.join(separator);
  }

  public refConvert(data: RefObject): string {
    //TODO: REF
    //REF: AWS::Partition. AWS::REGION, AWS::AccountId
    if (!data.Ref) {
      throw new Error('Cannot find Ref!');
    }
    if (Object.prototype.hasOwnProperty.call(this.refMaps, data.Ref)) {
      return this.refMaps[data.Ref];
    }

    return '';
  }
}
