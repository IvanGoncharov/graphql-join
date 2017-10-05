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


function validation() {
  // TODO:
  // JOIN AST:
  //   - validate that all directive known and locations are correct
  //   - type refs should be resolved without conflicts
  //   - no specified directives inside join AST
  //   - all references to remote types have no conficts
  //   - all fields inside extends and type defs should have @resolveWith
  //   - all field args + all fragment exports used in operation
  //   - fields return types should match types returned by "query" including LIST and NON_NULL
  //   - TEMPORARY: @resolveWith for root fields shouldn't use fragments
  // schema:
  //   - check for subscription in schema and `Subscription` type and error as not supported
  //   - references to Query and Mutation roots point to exactly one remote type
  //   - reference only roots of the same type from remote schema
  // fragments:
  //   - shoud have uniq names
  //   - shouldn't reference other fragments
  //   - should have atleast one leaf
  //   - all scalars should have exports directive
  //   - names in export directive should be uniq
  //   - should be used in @resolveWith
  //   - no field alliases
  //   - forbid @skip/@include
  //   - TEMPORARY: fragment shouldn't contain fields with @resolveWith
  //   - should be used only on objects which is equal or inherate from type condition
  // operations:
  //   - only query and mutation no subscription
  //   - mutation should be used only on fields in mutation root
  //   - should have name
  //   - shoud have uniq names
  //   - should have @send(to:)
  //   - valid against external schema
  //   - should have exactly one "leaf" which is "{...CLIENT_SELECTION}" or scalar
  //   - don't reference other fragments
  //   - should be used in @resolveWith
  //   - no field alliases
  //   - forbid @skip/@include
}
