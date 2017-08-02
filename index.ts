import { readFileSync } from 'fs';
import { GraphQLClient } from 'graphql-request';
import {
  Source,
  ASTNode,
  DocumentNode,
  DefinitionNode,
  GraphQLSchema,
  IntrospectionQuery,
  IntrospectionType,
  IntrospectionTypeRef,
  IntrospectionNamedTypeRef,

  Kind,
  parse,
  printSchema,
  extendSchema,
  buildASTSchema,
  buildClientSchema,
  introspectionQuery
} from 'graphql';

import {
  flatten,
} from 'lodash';

function readGraphQLFile(path: string): DocumentNode {
  const data = readFileSync(path, 'utf-8');
  return parse(new Source(data, path));
}

async function getIntrospection(settings): Promise<IntrospectionQuery> {
  const { url, headers } = settings;
  const client = new GraphQLClient(url, { headers });
  return await client.request(introspectionQuery) as IntrospectionQuery;
}

function isBuiltinType(name: string) {
  return name.startsWith('__') || [
    'String', 'Int', 'ID', 'Float', 'Boolean'
  ].indexOf(name) !== -1;
}

function addPrefixToIntrospection(
  introspection: IntrospectionQuery,
  prefix?: String
) {
  if (prefix == null) {
    return;
  }

  function prefixType(
    obj: IntrospectionNamedTypeRef | IntrospectionType | undefined
  ) {
    if (obj == null || isBuiltinType(obj.name)) {
      return;
    }
    obj.name = prefix + obj.name;
  }

  function prefixWrappedType(obj: IntrospectionTypeRef) {
    if (obj.kind === 'LIST' || obj.kind === 'NON_NULL') {
      if (obj['ofType']) {
        prefixWrappedType(obj['ofType']);
      }
    } else {
      prefixType(obj as IntrospectionNamedTypeRef);
    }
  }

  function prefixTypeRef(container: {type: IntrospectionTypeRef}) {
    prefixWrappedType(container.type);
  }

  const { __schema: schema } = introspection;
  prefixType(schema.queryType);
  prefixType(schema.mutationType);
  prefixType(schema.subscriptionType);
  schema.directives.forEach(
    directive => directive.args.forEach(prefixTypeRef)
  );
  schema.types.forEach(type => {
    prefixType(type);
    (Object.values(type['fields'] || {})).forEach(field => {
      prefixTypeRef(field);
      field.args.forEach(prefixTypeRef);
    });
    (type['interfaces'] || []).forEach(prefixType);
    (type['possibleTypes'] || []).forEach(prefixType);
    (Object.values(type['inputFields'] || {})).forEach(prefixTypeRef);
  });
}

const endpoints = {
  graphcool: {
    url: 'http://localhost:9002/graphql'
  },
  yelp: {
    prefix: 'Yelp_',
    url: 'https://api.yelp.com/v3/graphql',
    headers: {
      'Authorization': 'Bearer ' + process.env.YELP_TOKEN
    }
  }
};

async function getSchemasFromEndpoints(
): Promise<{ [name: string]: GraphQLSchema }> {
  const remoteSchemas = {};

  for (const [name, settings] of Object.entries(endpoints)) {
    const introspection = await getIntrospection(settings);
    try {
      buildClientSchema(introspection);
    } catch (e) {
      // FIXME: prefix
      throw e;
    }

    addPrefixToIntrospection(introspection, settings['prefix']);
    remoteSchemas[name] = buildClientSchema(introspection);
  }
  return remoteSchemas;
}

function splitAST(documentAST: DocumentNode): { [name: string]: DefinitionNode[] } {
  const result = {};
  for (const node of documentAST.definitions) {
    result[node.kind] = result[node.kind] || [];
    result[node.kind].push(node);
  }
  return result;
}

function makeASTDocument(definitions: DefinitionNode[]): DocumentNode {
  return {
    kind: Kind.DOCUMENT,
    definitions,
  };
}

async function buildJoinSchema(
  joinAST: DocumentNode,
  remoteSchemas: GraphQLSchema[]
): Promise<GraphQLSchema> {
  const remoteDefinitionNodes = remoteSchemas.map(schema => {
    const SDL = printSchema(schema as GraphQLSchema);
    const astNodeMap = splitAST(parse(SDL));
    delete astNodeMap[Kind.SCHEMA_DEFINITION];
    return flatten(Object.values(astNodeMap));
  });

  const astNodeMap = splitAST(joinAST);
  const extensionsAST = makeASTDocument(
    astNodeMap[Kind.TYPE_EXTENSION_DEFINITION]
  );

  // const fragments = astNodeMap[Kind.OPERATION_DEFINITION];
  // const operations = astNodeMap[Kind.FRAGMENT_DEFINITION];

  delete astNodeMap[Kind.TYPE_EXTENSION_DEFINITION];
  delete astNodeMap[Kind.OPERATION_DEFINITION];
  delete astNodeMap[Kind.FRAGMENT_DEFINITION];

  const joinSDLNodes = flatten(Object.values(astNodeMap));

  const mergedSDL = makeASTDocument([
    ...joinSDLNodes,
    ...flatten(Object.values(remoteDefinitionNodes)),
  ]);

  const mergedSchema = buildASTSchema(mergedSDL);
  return extendSchema(mergedSchema, extensionsAST);
}

async function main() {
  const joinAST = readGraphQLFile('./join.graphql');
  const remoteSchemas = await getSchemasFromEndpoints();
  const schema = await buildJoinSchema(joinAST, Object.values(remoteSchemas));
  console.log(printSchema(schema));
}

main();
