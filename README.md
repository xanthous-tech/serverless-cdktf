# serverless-cdktf

A [serverless](https://serverless.com) plugin that deploys AWS serverless stack via Terraform, using [CDKTF](https://github.com/hashicorp/terraform-cdk).

# Usage

```shell
yarn add serverless-cdktf --dev
```

just add the plu    gin into the `plugins` field in `serverless.yml` and it will do the rest.

# variables

config varibles in `serverless.yaml` custom part:

```
custom:
  cdktf:
    accountId: xxxxx
    deploymentBucketName: xxxxxxx
    s3backend:
      bucket: xxxxxxx
      key: xxx
    binPath: ../node_modules/.bin

```


# Resources Supported

- [x] S3 Bucket
- [X] S3 Bucket Policy
- [X] Lambda Functions
- [X] IAM Roles and Policy Documents
- [X] API Gateway
- [X] CloudFront Distribution

# License

[MIT](./LICENSE).
