import { keyBy } from 'lodash';
import {
  DocumentNode,
  buildSchema,

  validate,

  DirectiveNode,
  GraphQLDirective,
  getDirectiveValues,
} from 'graphql';

// TODO: add description for arguments and directives
export const directiveIDL = `
  directive @export(as: String!) on FIELD
  directive @send(to: String!) on QUERY

  directive @resolveWith(
    query: String!,
    extraArgs: ExtraArgs,
    transformArgs: String
  ) on FIELD_DEFINITION

  input ExtraArgs {
    fromFragment: String
  }

  # Dummy type
  type Query {
    dummy: String
  }
`;
export const directiveSchema = buildSchema(directiveIDL);
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
export const getResolveWithDirective = buildGetter<{
  query: string,
  extraArgs?: { fromFragment?: string },
  transformArgs?: string
}>(resolveWithDirective);
