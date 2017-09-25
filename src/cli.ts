import { readFileSync } from 'fs';

import * as path from 'path';
import * as express from 'express';
import * as graphqlHTTP from 'express-graphql';
import { Source, printSchema } from 'graphql';

import {
  EndpointMap,
  ProxyContext,
  GraphQLJoinSchema,
  getRemoteSchemas,
} from './index';

const endpoints: EndpointMap = {
  graphcool: {
    url: 'http://localhost:9010/graphql'
  },
  yelp: {
    prefix: 'Yelp_',
    url: 'https://api.yelp.com/v3/graphql',
    headers: {
      'Authorization': 'Bearer ' + process.env.YELP_TOKEN
    }
    // TODO: headers white listing from request
  }
};

function readGraphQLFile(path: string): Source {
  const data = readFileSync(path, 'utf-8');
  return new Source(data, path);
}

async function main() {
  const joinIDL = readGraphQLFile('./join.graphql');
  const {remoteSchemas, proxyFns} = await getRemoteSchemas(endpoints);
  const joinSchema = new GraphQLJoinSchema(joinIDL, remoteSchemas);
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

