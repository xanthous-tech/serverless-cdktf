import Serverless from 'serverless';
import { Hooks } from 'serverless/classes/Plugin';
import { createCdktfJson, runCdktfGet, runCdktfSynth, runCdktfDeploy } from './utils/cdktf';

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
    // console.log(pluginHooks['aws:deploy:deploy:createStack']);
    // console.log(pluginHooks['aws:deploy:deploy:updateStack']);

    //Set noDeploy config
    // this.options['noDeploy'] = true;
    // console.log(options);

    this.hooks = {
      // 'after:package:finalize': this.convertToTerraformStack.bind(this),
      'aws:deploy:deploy:createStack': this.createTerraformStack.bind(this),
      'aws:deploy:deploy:updateStack': this.convertToTerraformStack.bind(this, 'update-stack'),
    };
  }

  private async createTerraformStack(): Promise<void> {
    await this.convertToTerraformStack('create-stack');
    // inject bucket name into serverless provider
    this.serverless.service.provider.deploymentBucket = this.serverless.service.custom.deploymentBucketName;
  }

  private async convertToTerraformStack(stack: string): Promise<void> {
    await createCdktfJson(this.serverless);
    await runCdktfGet(this.serverless);
    await runCdktfSynth(this.serverless, stack);
    await runCdktfDeploy(this.serverless, stack);
  }
}

export = ServerlessCdktfPlugin;
