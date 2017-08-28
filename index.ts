import { GraphQLClient } from 'graphql-request';
import {
  TypeDefinitionNode,
  GraphQLSchema,
  GraphQLNamedType,
  IntrospectionQuery,

  printSchema,
  extendSchema,
  buildASTSchema,
  buildClientSchema,
  introspectionQuery,
  getDirectiveValues,
} from 'graphql';

import {
  keyBy,
  flatten,
  fromPairs,
  mapValues,
} from 'lodash';

import {
  validateDirectives,
  exportDirective,
  resolveWithDirective,
} from './directives';

import {
  SplittedAST,

  stubType,
  isBuiltinType,
  addPrefixToTypeNode,
  splitAST,
  makeASTDocument,
  schemaToASTTypes,
  readGraphQLFile,
} from './utils';

// GLOBAL TODO:
//   - check that mutation is executed in sequence

async function getRemoteSchema(settings): Promise<GraphQLSchema> {
  const { url, headers } = settings;
  const client = new GraphQLClient(url, { headers });
  const introspection = await client.request(introspectionQuery) as IntrospectionQuery;
  return buildClientSchema(introspection);
}

type Endpoint = {
  prefix?: string
  url: string
  headers?: {[name: string]: string}
};

const endpoints: { [name: string]: Endpoint } = {
  graphcool: {
    url: 'http://localhost:9002/graphql'
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

async function buildJoinSchema(
  joinDefs: SplittedAST,
  remoteSchemas: RemoteSchemasMap,
): Promise<GraphQLSchema> {
  const remoteTypeNodes = getRemoteTypeNodes(remoteSchemas);

  const typeToSourceAPI = {};
  for (const [source, types] of Object.entries(remoteTypeNodes)) {
    for (const {name: {value}} of types) {
      typeToSourceAPI[value] = source;
    }
  }

  const schema = buildSchemaFromSDL({
    ...joinDefs,
    types: [
      ...joinDefs.types,
      ...flatten(Object.values(remoteTypeNodes)),
    ],
  });

  for (const type of Object.values(schema.getTypeMap())) {
    type['originTypes'] = getOriginTypes(type.name);
  }
  return schema;

  function getOriginTypes(
    typeName: string
  ): { [sourceAPI: string]: GraphQLNamedType } | void {
    const sourceAPI = typeToSourceAPI[typeName];
    if (!sourceAPI) {
      return undefined;
    }

    const originTypes = {};
    const {schema, prefix} = remoteSchemas[sourceAPI];
    let originName = typeName;

    if (prefix) {
      originName = originName.replace(prefix, '');
    }

    // TODO: support for merging same type from different APIs, need to
    // support in schema build
    originTypes[sourceAPI] = schema.getType(originName)
    return originTypes;
  }
}

function validation() {

  // TODO:
  // JOIN AST:
  //   - validate that all directive known and locations are correct
  //   - no specified directives inside join AST
  // fragments:
  //   - shoud have uniq names
  //   - shouldn't reference other fragments
  //   - should have atleast one leaf
  //   - all scalars should have exports directive
  //   - names in export directive should be uniq
  //   - should be used in @resolveWith
  // operations:
  //   - only query and mutation no subscription
  //   - should have name
  //   - shoud have uniq names
  //   - should have @send(to:)
  //   - valid against external schema
  //   - should have atleast one "leaf" which is exactly "{...USER_SELECTION}"
  //   - don't reference other fragments
  //   - should be used in @resolveWith
}

function buildSchemaFromSDL(defs: SplittedAST) {
  const sdl = makeASTDocument([
    ...defs.schemas,
    ...defs.types,
  ]);

  let schema = buildASTSchema(sdl);

  const extensionsAST = makeASTDocument(defs.typeExtensions);
  return extendSchema(schema, extensionsAST);
}

type RemoteSchemasMap = { [name: string]: { schema: GraphQLSchema, prefix?: string } };
async function getRemoteSchemas(): Promise<RemoteSchemasMap> {
  const promises = Object.entries(endpoints).map(
    async ([name, endpoint]) => {
      const {prefix, ...settings} = endpoint;
      return [name, {
        prefix,
        schema: await getRemoteSchema(settings),
      }]
    }
  );
  return Promise.all(promises).then(pairs => fromPairs(pairs));
}

function getRemoteTypeNodes(
  remoteSchemas: RemoteSchemasMap
): { [name: string]: TypeDefinitionNode[] } {
  return mapValues(remoteSchemas, ({schema, prefix}, name) => {
    const types = schemaToASTTypes(schema, name)
    if (prefix) {
      types.forEach(type => addPrefixToTypeNode(prefix, type));
    }
    return types;
  });
}

async function main() {
  const remoteSchemas = await getRemoteSchemas();
  const joinAST = readGraphQLFile('./join.graphql');
  const joinDefs = splitAST(joinAST);

  const schema = await buildJoinSchema(joinDefs, remoteSchemas);
  // FIXME: check for subscription and error as not supported
  console.log(printSchema(schema));

  const operations = keyBy(joinDefs.operations, operation => {
    if (!operation.name) {
      throw new Error('Does not support anonymous operation.');
    }
    return operation.name.value;
  });

  const fragments = keyBy(joinDefs.fragments, fragment => fragment.name.value);
  for (const type of Object.values(schema.getTypeMap())) {
    if (isBuiltinType(type.name)) {
      continue;
    }

    stubType(type);
  }
}

main().catch(e => {
  console.log(e);
});
