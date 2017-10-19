import { readFileSync } from 'fs';
import { join as joinPaths, dirname } from 'path';

import * as yaml from 'js-yaml';
import * as express from 'express';
import * as graphqlHTTP from 'express-graphql';
import { Source, printSchema } from 'graphql';

import {
  EndpointMap,
  getRemoteSchemas,
} from './index';

import { GraphQLJoinSchema } from './GraphQLJoinSchema';
import { ProxyContext } from './ProxyContext';
import resolveEnvRefs from './resolveEnvRefs';

async function main() {
  const configPath = './join.yaml';
  const basePath = dirname(configPath);
  const config = resolveEnvRefs(
    yaml.safeLoad(readFileSync(configPath, 'utf-8'))
  );
  const endpoints = config.apis as EndpointMap;
  const joinIDL = config.joinIDL as string;
  const modulePath = config.transformModule
  let transformModule;
  if (modulePath) {
    transformModule = require(joinPaths(basePath, modulePath));
  }

  const {remoteSchemas, proxyFns} = await getRemoteSchemas(endpoints);
  const joinSchema = new GraphQLJoinSchema(
    joinIDL,
    remoteSchemas,
    transformModule
  );
  console.log(printSchema(joinSchema.schema));

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
