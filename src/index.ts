import { GraphQLClient } from 'graphql-request';
import {
  DocumentNode,

  ExecutionResult,
  GraphQLSchema,
  IntrospectionQuery,

  print,
  parse,
  buildClientSchema,
  introspectionQuery,
} from 'graphql';

import { RemoteSchemasMap } from './GraphQLJoinSchema';
import { SchemaProxyFnMap, SchemaProxyFn } from './ProxyContext';

// PROXY:
// timeout
// ratelimiting for proxy queries
// proxy Relay node, ID => ${schemaName}/ID
// GLOBAL TODO:
//   - check that mutation is executed in sequence
//   - handle 'argumentsFragment' on root fields

function makeProxy(settings): SchemaProxyFn {
  const { url, headers } = settings;
  const client = new GraphQLClient(url, { headers });
  return async (queryDocument: DocumentNode, variableValues?: object) => {
    // FIXME: conver errors
    // FIXME: better client
    const query = print(queryDocument);
    const data = await client.request(query, variableValues);
    return { data } as ExecutionResult;
  };
}

const parsedIntrospectionQuery = parse(introspectionQuery);
export async function getRemoteSchemas(
  endpoints: EndpointMap
): Promise<{remoteSchemas: RemoteSchemasMap, proxyFns: SchemaProxyFnMap}> {
  const promises = Object.entries(endpoints).map(
    async ([name, endpoint]) => {
      const {prefix, ...settings} = endpoint;
      const proxyFn = makeProxy(settings);
      const introspectionResult = await proxyFn(parsedIntrospectionQuery, {});
      const introspection = introspectionResult.data as IntrospectionQuery;
      const schema = buildClientSchema(introspection);

      return {name, remoteSchema: { prefix, schema }, proxyFn };
    }
  );

  return Promise.all(promises).then(result => {
    const remoteSchemas = {};
    const proxyFns = {};
    for (const {name, remoteSchema, proxyFn} of result) {
      remoteSchemas[name] = remoteSchema;
      proxyFns[name] = proxyFn;
    }
    return { remoteSchemas, proxyFns };
  });
}

type Endpoint = {
  prefix?: string
  url: string
  headers?: {[name: string]: string}
};
export type EndpointMap = { [name: string]: Endpoint };
