import path from 'path';
import fs from 'fs-extra';
import yargs from 'yargs';
import { App } from 'cdktf';
import Serverless from 'serverless';

import { Cf2Tf } from './stack';

const argv = yargs.option('s', {
  alias: 'stack',
  description: 'stack type',
  choices: ['create-stack', 'update-stack'],
  demand: true,
}).argv;

(async function () {
  // load serverless variables
  const serverless = new Serverless();
  await serverless.init();

  const stackName = `${serverless.service.getServiceName()}-${serverless.service.provider.stage}`;

  const app = new App();

  const filename = path.resolve(process.cwd(), '.serverless', `cloudformation-template-${argv.stack}.json`);
  const resources = await fs.readJson(filename);

  new Cf2Tf(app, stackName, serverless, resources);

  app.synth();
})();
