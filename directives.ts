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
  directive @send(to: String!) on QUERY

  directive @resolveWith(
    query: String!,
    argumentsFragment: String
  ) on FIELD_DEFINITION

  # Dummy type
  type Query {
    dummy: String
  }
`;

const directiveSchema = buildSchema(directiveIDL);
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
