import { keyBy } from 'lodash';
import {
  Kind,
  DocumentNode,
  buildSchema,
  GraphQLScalarType,

  validate,
  ArgumentsOfCorrectTypeRule,
  KnownArgumentNamesRule,
  KnownDirectivesRule,
  ProvidedNonNullArgumentsRule,
  UniqueArgumentNamesRule,
  UniqueDirectivesPerLocationRule,
  UniqueInputFieldNamesRule,
} from 'graphql';

const directiveIDL = `
  directive @export(as: String!) on FIELD

  directive @resolveWith(
    query: String!,
    argumentsFragment: String
  ) on FIELD_DEFINITION

  scalar PrefixMap
  directive @typePrefix(map: PrefixMap!) on SCHEMA

  # Dummy type
  type Query {
    dummy: String
  }
`;

const directiveSchema = buildSchema(directiveIDL);
const PrefixMap = directiveSchema.getTypeMap()['PrefixMap'] as GraphQLScalarType;
PrefixMap.parseLiteral = (ast) => {
  const error =  Error(
    '@typePrefix expects object with API name as a key and prefix string as a value'
  );
  if (ast.kind !== Kind.OBJECT) {
    throw error;
  }
  return ast.fields.reduce((object, {name, value: valueAST}) => {
    if (valueAST.kind !== Kind.STRING) {
      throw error;
    }
    object[name.value] = valueAST.value;
    return object;
  }, {});
}

const directives = keyBy(directiveSchema.getDirectives(), 'name');

export const exportDirective = directives['export'];
export const resolveWithDirective = directives['resolveWith'];
export const typePrefixDirective = directives['typePrefix'];

export function validateDirectives(ast: DocumentNode): void {
  const errors = validate(directiveSchema, ast, [
    ArgumentsOfCorrectTypeRule,
    KnownArgumentNamesRule,
    KnownDirectivesRule,
    ProvidedNonNullArgumentsRule,
    UniqueArgumentNamesRule,
    UniqueDirectivesPerLocationRule,
    UniqueInputFieldNamesRule,
  ]);

  if (errors.length !== 0) {
    throw new Error('Validation errors:\n\t' + errors.map(e => e.message).join('\n\t'));
  }
}
