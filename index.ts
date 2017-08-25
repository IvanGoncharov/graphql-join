import { GraphQLClient } from 'graphql-request';
import {
  TypeDefinitionNode,
  GraphQLSchema,
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
  joinAST: SplittedAST,
  remoteSchemas: RemoteSchemasMap,
): Promise<GraphQLSchema> {
  const remoteTypeNodes = getRemoteTypeNodes();

  const typeToSourceAPI = {};
  for (const [source, types] of Object.entries(remoteTypeNodes)) {
    for (const {name: {value}} of types) {
      typeToSourceAPI[value] = source;
    }
  }

  const schema = buildSchemaFromSDL();
  for (const type of Object.values(schema.getTypeMap())) {
    const sourceAPI = typeToSourceAPI[type.name];
    if (sourceAPI) {
      const {schema, prefix} = remoteSchemas[sourceAPI];
      let originName = type.name;

      if (prefix) {
        originName = originName.replace(prefix, '');
      }

      // TODO: support for merging same type from different APIs, need to
      // support in schema build
      type['originTypes'] = {
        [sourceAPI]: schema.getType(originName)
      };
    }
  }
  return schema;

  function buildSchemaFromSDL() {
    const mergedSDL = makeASTDocument([
      ...joinAST.types,
      ...flatten(Object.values(remoteTypeNodes)),
    ]);

    let schema = buildASTSchema(mergedSDL);

    const extensionsAST = makeASTDocument(joinAST.typeExtensions);
    schema = extendSchema(schema, extensionsAST);

    for (const type of Object.values(schema.getTypeMap())) {
      if (!isBuiltinType(type.name)) {
        stubType(type);
      }
    }

    return schema;
  }

  function getRemoteTypeNodes(): { [name: string]: TypeDefinitionNode[] } {
    return mapValues(remoteSchemas, ({schema, prefix}, name) => {
      const types = schemaToASTTypes(schema, name)
      if (prefix) {
        types.forEach(type => addPrefixToTypeNode(prefix, type));
      }
      return types;
    });
  }
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

async function main() {
  const joinAST = splitAST(readGraphQLFile('./join.graphql'));
  const remoteSchemas = await getRemoteSchemas();

  // FIXME: validate that all directive known and locations are correct
  // FIXME: error if specified directives join AST
  // validateDirectives(joinAST);

  const schema = await buildJoinSchema(joinAST, remoteSchemas);
  // FIXME: check for subscription and error as not supported
  console.log(printSchema(schema));

  const operations = keyBy(joinAST.operations, operation => {
    if (!operation.name) {
      throw new Error('Does not support anonymous operation.');
    }
    return operation.name.value;
  });

  const fragments = keyBy(joinAST.fragments, fragment => fragment.name.value);
  // TODO: check that mutation is executed in sequence
}

main().catch(e => {
  console.log(e);
});
