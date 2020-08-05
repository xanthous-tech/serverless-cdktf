import fs from 'fs';
import { spawnSync } from 'child_process';
import { App } from 'cdktf';

import Serverless from 'serverless';

import { MyStack } from './stack';

export function convert(serverless: Serverless, fileName: string): App {
  serverless.cli.log('removing cdktf.out');
  fs.rmdirSync('cdktf.out', { recursive: true });
  serverless.cli.log('writing cdktf.json');
  fs.writeFileSync(
    'cdktf.json',
    JSON.stringify(
      {
        language: 'typescript',
        codeMakerOutput: '.serverless/.gen',
        output: '.serverless/cdktf.out',
        terraformProviders: ['aws@~> 2.0'],
      },
      null,
      2,
    ),
  );
  serverless.cli.log('running cdktf get');
  const result = spawnSync(`./node_modules/.bin/cdktf`, ['get'], {
    cwd: process.cwd(),
  });

  serverless.cli.log(result.stdout?.toString());
  serverless.cli.log(result.stderr?.toString());

  const data = fs.readFileSync(fileName);
  const app = new App({ stackTraces: true });
  new MyStack(app, 'mystack', data.toString());
  return app;
}
