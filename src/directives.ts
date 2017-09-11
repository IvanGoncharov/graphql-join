import { keyBy } from 'lodash';
import {
  DocumentNode,
  buildSchema,

  validate,
  ArgumentsOfCorrectTypeRule,
  KnownArgumentNamesRule,
  KnownDirectivesRule,
  ProvidedNonNullArgumentsRule,
  UniqueArgumentNamesRule,
  UniqueDirectivesPerLocationRule,
  UniqueInputFieldNamesRule,

  DirectiveNode,
  GraphQLDirective,
  getDirectiveValues,
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


function buildGetter<T>(
  directive: GraphQLDirective
): (node?: { directives?: Array<DirectiveNode> }) => T | undefined {
  return (node) => {
    return node && (getDirectiveValues(directive, node) as T);
  };
}

export const exportDirective = directives['export'];
export const getExportDirective = buildGetter<{ as: string }>(exportDirective);

export const sendDirective = directives['send'];
export const getSendDirective = buildGetter<{ to: string }>(sendDirective);

export const resolveWithDirective = directives['resolveWith'];
export const getResolveWithDirective =
  buildGetter<{ query: string, argumentsFragment?: string }>(resolveWithDirective);

export function validateDirectives(ast: DocumentNode): void {
  // FIXME: check that there no query arguments inside directive values
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
