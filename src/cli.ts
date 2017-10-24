#!/usr/bin/env node
import { readFileSync } from 'fs';
import { resolve as resolvePaths, dirname } from 'path';

import * as yaml from 'js-yaml';
import * as express from 'express';
import * as graphqlHTTP from 'express-graphql';

import {
  EndpointMap,
  getRemoteSchemas,
} from './index';

import { GraphQLJoinSchema } from './GraphQLJoinSchema';
import { ProxyContext } from './ProxyContext';
import resolveEnvRefs from './resolveEnvRefs';

async function main() {
  const configPath = process.argv[2];
  if (!configPath) {
    throw Error('Specify path to join config!');
  }

  const basePath = dirname(configPath);
  const config = resolveEnvRefs(
    yaml.safeLoad(readFileSync(configPath, 'utf-8'))
  );
  const endpoints = config.apis as EndpointMap;
  const joinIDL = config.joinIDL as string;
  const modulePath = config.transformModule
  let transformModule;
  if (modulePath) {
    transformModule = require(resolvePaths(basePath, modulePath));
  }

  const {remoteSchemas, proxyFns} = await getRemoteSchemas(endpoints);
  const joinSchema = new GraphQLJoinSchema(
    joinIDL,
    remoteSchemas,
    transformModule
  );
  //console.log(printSchema(joinSchema.schema));

  const app = express();

  app.use('/graphql', graphqlHTTP({
    schema: joinSchema.schema,
    context: new ProxyContext(joinSchema, proxyFns),
    graphiql: true,
    formatError: error => ({
      message: error.message,
      locations: error.locations,
      stack: error.stack,
      path: error.path
    }),
  }));

  app.listen(4000);
  console.log('\n\nhttp://localhost:4000/graphql');
}

main().catch(e => {
  console.log(e);
});
