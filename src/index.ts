import Serverless from 'serverless';
import { Hooks } from 'serverless/classes/Plugin';
import { createCdktfJson, runCdktfGet, runCdktfSynth, runCdktfDeploy, runCdktfDestroy } from './utils/cdktf';

interface PluginDefinition {
  pluginName: string;
}

class ServerlessCdktfPlugin {
  serverless: Serverless;
  options: Serverless.Options;
  hooks: Hooks;

  constructor(serverless: Serverless, options: Serverless.Options) {
    this.serverless = serverless;
    this.options = options;

    serverless.cli.log('overriding AWS provider hooks');
    const pluginHooks = serverless.pluginManager.hooks as any;
    pluginHooks['aws:deploy:deploy:createStack'] = pluginHooks['aws:deploy:deploy:createStack'].filter(
      (plugin: PluginDefinition) => plugin.pluginName !== 'AwsDeploy',
    );
    pluginHooks['aws:deploy:deploy:updateStack'] = pluginHooks['aws:deploy:deploy:updateStack'].filter(
      (plugin: PluginDefinition) => plugin.pluginName !== 'AwsDeploy',
    );
    pluginHooks['remove:remove'] = pluginHooks['remove:remove'].filter((plugin: PluginDefinition) => plugin.pluginName !== 'AwsRemove');
    // kill all aws:info:* hooks
    pluginHooks['aws:info:validate'] = [];
    pluginHooks['aws:info:gatherData'] = [];
    pluginHooks['aws:info:displayServiceInfo'] = [];
    pluginHooks['aws:info:displayApiKeys'] = [];
    pluginHooks['aws:info:displayEndpoints'] = [];
    pluginHooks['aws:info:displayFunctions'] = [];
    pluginHooks['aws:info:displayLayers'] = [];
    pluginHooks['aws:info:displayStackOutputs'] = [];

    // console.log(pluginHooks['aws:deploy:deploy:createStack']);
    // console.log(pluginHooks['aws:deploy:deploy:updateStack']);

    // TODO: remove procedures
    this.hooks = {
      // 'after:package:finalize': this.convertToTerraformStack.bind(this),
      'aws:deploy:deploy:createStack': this.createTerraformStack.bind(this),
      'aws:deploy:deploy:updateStack': this.convertToTerraformStack.bind(this, 'update-stack'),
      'remove:remove': this.removeTerraformStack.bind(this),
    };

    // find fullstack-serverless plugin and disable the distribution invalidation step
    const fullstackServerlessPlugin: any = serverless.pluginManager.plugins.find((plugin) => plugin.constructor.name === 'ServerlessFullstackPlugin');
    if (fullstackServerlessPlugin) {
      serverless.cli.log('disabling distribution invalidation in fullstack-serverless plugin, you may need to invalidate yourself');
      fullstackServerlessPlugin.cliOptions['invalidate-distribution'] = false;
    }
  }

  private async removeTerraformStack(): Promise<void> {
    this.serverless.cli.log('removing terraform stack');

    const deploymentBucketName = this.serverless.service.custom.cdktf.deploymentBucketName;
    this.serverless.cli.log('injecting deployment bucket name into serverless instance');
    this.serverless.service.provider.deploymentBucket = deploymentBucketName;

    const awsRemovePlugin: any = this.serverless.pluginManager.plugins.find((plugin) => plugin.constructor.name === 'AwsRemove');

    if (!awsRemovePlugin) {
      throw new Error('cannot find aws remove plugin');
    }

    try {
      await awsRemovePlugin.validate();
      await awsRemovePlugin.emptyS3Bucket();
      await runCdktfDestroy(this.serverless, 'update-stack');
    } catch (err) {
      this.serverless.cli.log('error during stack remove');
      throw err;
    }
  }

  private async createTerraformStack(): Promise<void> {
    // skip stack creation if deployment bucket exists
    const awsDeployPlugin: any = this.serverless.pluginManager.plugins.find((plugin) => plugin.constructor.name === 'AwsDeploy');

    if (!awsDeployPlugin) {
      throw new Error('cannot find aws deploy plugin');
    }

    const deploymentBucketName = this.serverless.service.custom.cdktf.deploymentBucketName;

    try {
      await awsDeployPlugin.existsDeploymentBucket(deploymentBucketName);
      this.serverless.cli.log('deployent bucket already exists, skipping stack creation');
    } catch (err) {
      await this.convertToTerraformStack('create-stack');
    } finally {
      // inject bucket name into serverless provider
      this.serverless.cli.log('injecting deployment bucket name into serverless instance');
      this.serverless.service.provider.deploymentBucket = deploymentBucketName;
    }
  }

  private async convertToTerraformStack(stack: string): Promise<void> {
    this.serverless.cli.log(`converting Serverless CF Stack ${stack} using CDKTF...`);
    await createCdktfJson(this.serverless);
    await runCdktfGet(this.serverless);

    // if (this.options['noDeploy'] || (this.serverless.service.provider as any).shouldNotDeploy) {
    //   await runCdktfSynth(this.serverless, stack);
    // } else {
    await runCdktfDeploy(this.serverless, stack);
    // }
  }
}

export = ServerlessCdktfPlugin;
