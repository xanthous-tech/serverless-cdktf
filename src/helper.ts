import * as fs from 'fs';
import { MyStack } from './stack';
import { App } from 'cdktf';

export function convert(fileName: string): App {
  //Readfile.
  const data = fs.readFileSync(fileName);
  const app = new App();
  new MyStack(app, 'mystack', data.toString());
  return app;
}
