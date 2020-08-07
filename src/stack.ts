import Serverless from 'serverless';
import { TerraformStack, TerraformOutput, TerraformResource, S3Backend } from 'cdktf';
import { Construct } from 'constructs';
import { AwsProvider, S3Bucket, DataAwsIamPolicyDocument, S3BucketPolicy, CloudwatchLogGroup, IamRole, IamRolePolicy } from '../.gen/providers/aws';

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

    this.refMaps = {
      'AWS::Region': serverless.service.provider.region,
      'AWS::Partition': 'aws',
      // "AWS::AccountId": provider.accessKey,
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

    //TODO: construct role name from json file.
    // const role_name = iamRoleProperties.RoleName
    const role_name = 'cdktf-example-region-lambda-role';

    const assumeRole = iamRoleProperties.AssumeRolePolicyDocument;
    const statement = assumeRole.Statement[0];

    const assume_role_policy = new DataAwsIamPolicyDocument(self, role_name + `assume_role_policy`, {
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

    const role = new IamRole(self, 'IamRoleLambdaExecution', {
      assumeRolePolicy: assume_role_policy.json,
      path: '/',
      //TODO: fix name
      name: 'aws_iam_role_lambda',
    });

    const iamRolePolicy = new DataAwsIamPolicyDocument(self, 'IamRoleLambdaExcutionPolicy', {
      statement: [
        {
          //TODO: fix it by using variables
          actions: ['logs:CreateLogStream', 'logs:CreateLogGroup'],
          effect: 'Allow',
          //TODO: fix resources.
          resources: [],
        },
        {
          actions: ['logs:PutLogEvents'],
          effect: 'Allow',
          //TODO: need convert.
          resources: [],
        },
      ],
    });

    //add iam role policy here.
    new IamRolePolicy(self, 'IamRoleLambdaExecutionPolicy', {
      //TODO: fix name
      name: 'cdktf-example-lambda',
      role: role.id ?? '',
      policy: iamRolePolicy.json,
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

  public handleOutputRef(self: Cf2Tf, { Ref }: RefObject): any {
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
  public handleResources(resources: any): string {
    //Contains Keys Fn::Get
    const fnFunc = ['Fn::Join'];

    let data = '';

    for (const key in resources) {
      if (fnFunc.includes(key)) {
        switch (key) {
          case 'Fn::Join':
            data = this.convertFnJoin(resources[key]);
            break;
        }
        break;
      }
    }

    return data;
  }

  public convertFnJoin(data: Array<any>): string {
    const separator = data[0];
    const others = <Array<any>>data.splice(1);
    const elements: Array<string> = [];
    for (let i = 0; i < others.length; i++) {
      if (typeof others[i] === 'string') {
        elements.push(others[i]);
      } else {
        //TODO: 如果是 Ref, 进行转换
        if (Object.prototype.hasOwnProperty.call(others[i], 'Ref')) {
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
