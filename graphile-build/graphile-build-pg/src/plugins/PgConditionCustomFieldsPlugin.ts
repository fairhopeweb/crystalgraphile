import "graphile-config";

import type {
  PgConditionStep,
  PgSelectStep,
  PgSource,
  PgSourceParameter,
  PgSourceParameterAny,
} from "@dataplan/pg";
import { EXPORTABLE } from "graphile-export";

import { getBehavior } from "../behavior.js";
import { version } from "../version.js";

declare global {
  namespace GraphileBuild {
    interface ScopeInputObjectFieldsField {
      isPgConnectionConditionInputField?: boolean;
      pgFieldSource?: PgSource<any, any, any, any, any>;
    }
  }
}

export const PgConditionCustomFieldsPlugin: GraphileConfig.Plugin = {
  name: "PgConditionCustomFieldsPlugin",
  description:
    "Add GraphQL conditions based on 'filterable' PostgreSQL functions",
  version: version,

  schema: {
    hooks: {
      GraphQLInputObjectType_fields(fields, build, context) {
        const { inflection, sql } = build;
        const {
          scope: { isPgCondition, pgCodec },
          fieldWithHooks,
        } = context;
        if (
          !isPgCondition ||
          !pgCodec ||
          !pgCodec.columns ||
          pgCodec.isAnonymous
        ) {
          return fields;
        }

        const functionSources = Object.values(
          build.input.pgRegistry.pgSources,
        ).filter((source) => {
          if (source.codec.columns) return false;
          if (source.codec.arrayOfCodec) return false;
          if (source.codec.rangeOfCodec) return false;
          const parameters: readonly PgSourceParameterAny[] | undefined =
            source.parameters;
          if (!parameters || parameters.length < 1) return false;
          if (parameters.some((p, i) => i > 0 && p.required)) return false;
          if (parameters[0].codec !== pgCodec) return false;
          if (!source.isUnique) return false;
          const behavior = getBehavior([
            source.codec.extensions,
            source.extensions,
          ]);
          return build.behavior.matches(
            behavior,
            "proc:filterBy",
            "-proc:filterBy",
          );
        });

        return build.extend(
          fields,
          functionSources.reduce((memo, rawPgFieldSource) => {
            const pgFieldSource = rawPgFieldSource as PgSource<
              any,
              any,
              any,
              readonly PgSourceParameterAny[],
              any
            >;
            const fieldName = inflection.computedColumnField({
              source: pgFieldSource,
            });
            const type = build.getGraphQLTypeByPgCodec(
              pgFieldSource.codec,
              "input",
            );
            if (!type) return memo;
            memo = build.extend(
              memo,
              {
                [fieldName]: fieldWithHooks(
                  {
                    fieldName,
                    fieldBehaviorScope: "proc:filterBy",
                    isPgConnectionConditionInputField: true,
                    pgFieldSource,
                  },
                  {
                    description: build.wrapDescription(
                      `Checks for equality with the object’s \`${fieldName}\` field.`,
                      "field",
                    ),
                    type,
                    applyPlan: EXPORTABLE(
                      (pgFieldSource, sql) =>
                        function plan(
                          $condition: PgConditionStep<PgSelectStep<any>>,
                          val,
                        ) {
                          if (typeof pgFieldSource.source !== "function") {
                            throw new Error("Invalid computed column source");
                          }
                          const expression = sql`${pgFieldSource.source({
                            placeholder: $condition.alias,
                          })}`;
                          if (val.getRaw().evalIs(null)) {
                            $condition.where(sql`${expression} is null`);
                          } else {
                            $condition.where(
                              sql`${expression} = ${$condition.placeholder(
                                val.get(),
                                pgFieldSource.codec,
                              )}`,
                            );
                          }
                        },
                      [pgFieldSource, sql],
                    ),
                  },
                ),
              },
              `Adding computed column condition argument for ${pgCodec.name}`,
            );
            return memo;
          }, Object.create(null)),
          `Adding computed column filterable functions to condition for '${pgCodec.name}'`,
        );
      },
    },
  },
};
