/*
 * This file contains all our utilities for dealing with Mermaid-js
 */

import type { OperationPlan } from ".";
import type { LayerPlan } from "./engine/LayerPlan";
import type { ExecutableStep } from "./step.js";
import { __ItemStep, __ListTransformStep } from "./steps/index.js";
import { stripAnsi } from "./stripAnsi.js";

/**
 * An array of hex colour codes that we use for colouring the buckets/steps in
 * the mermaid-js plan diagram.
 *
 * Generated by mokole.com/palette.html; re-ordered by Jem
 */
export const COLORS = [
  "#696969",
  "#00bfff",
  "#7f007f",
  "#ffa500",
  "#0000ff",
  "#7fff00",
  "#ff1493",
  "#808000",
  "#dda0dd",
  "#ff0000",
  "#ffff00",
  "#00ffff",
  "#4169e1",
  "#3cb371",
  "#a52a2a",
  "#ff00ff",
  "#f5deb3",
];

/**
 * Given a string, escapes the string so that it can be embedded as the description of a node in a mermaid chart.
 *
 * 1. If it's already safe, returns it verbatim
 * 2. If it contains disallowed characters, escape them by replacing them with similar-looking characters,
 * 3. Wrap the string in quote marks.
 *
 * @remarks
 *
 * NOTE: rather than doing literal escapes, we replace with lookalike characters because:
 *
 * 1. Mermaid has a bug when calculating the width of the node that doesn't respect escapes,
 * 2. It's easier to read the raw mermaid markup with substitutes rather than messy escapes.
 *
 * @internal
 */
export const mermaidEscape = (str: string): string => {
  if (str.match(/^[a-z0-9 ]+$/i)) {
    return str;
  }
  // Technically we should replace with escapes like this:
  //.replace(/[#"]/g, (l) => ({ "#": "#35;", '"': "#quot;" }[l as any]))
  // However there's a bug in Mermaid's rendering that causes the node to use
  // the escaped string as the width for the node rather than the unescaped
  // string. Thus we replace with similar looking characters.
  return `"${stripAnsi(str.trim())
    .replace(
      /[#"<>]/g,
      (l) => ({ "#": "ꖛ", '"': "”", "<": "ᐸ", ">": "ᐳ" }[l as any]),
    )
    .replace(/\r?\n/g, "<br />")}"`;
};

export interface PrintPlanGraphOptions {
  printPathRelations?: boolean;
  includePaths?: boolean;
  concise?: boolean;
}

/**
 * Convert an OpPlan into a plan graph; call this via `operationPlan.printPlanGraph()`
 * rather than calling this function directly.
 *
 * @internal
 */
export function printPlanGraph(
  operationPlan: OperationPlan,
  {
    // printPathRelations = false,
    concise = false,
  }: PrintPlanGraphOptions,
  {
    steps,
  }: {
    steps: ExecutableStep[];
  },
): string {
  const color = (i: number) => {
    return COLORS[i % COLORS.length];
  };

  const planStyle = `fill:#fff,stroke-width:1px,color:#000`;
  const itemplanStyle = `fill:#fff,stroke-width:2px,color:#000`;
  const unbatchedplanStyle = `fill:#dff,stroke-width:1px,color:#000`;
  const sideeffectplanStyle = `fill:#fcc,stroke-width:2px,color:#000`;
  const graph = [
    `%%{init: {'themeVariables': { 'fontSize': '12px'}}}%%`,
    `${concise ? "flowchart" : "graph"} TD`,
    `    classDef path fill:#eee,stroke:#000,color:#000`,
    `    classDef plan ${planStyle}`,
    `    classDef itemplan ${itemplanStyle}`,
    `    classDef unbatchedplan ${unbatchedplanStyle}`,
    `    classDef sideeffectplan ${sideeffectplanStyle}`,
    `    classDef bucket fill:#f6f6f6,color:#000,stroke-width:2px,text-align:left`,
    ``,
  ];

  const squish = (str: string, start = 8, end = 8): string => {
    if (str.length > start + end + 4) {
      return `${str.slice(0, start)}...${str.slice(str.length - end)}`;
    }
    return str;
  };

  const planIdMap = Object.create(null);
  const planId = (plan: ExecutableStep): string => {
    if (!planIdMap[plan.id]) {
      const planName = plan.constructor.name.replace(/Step$/, "");
      const planNode = `${planName}${plan.id}`;
      planIdMap[plan.id] = planNode;
      const rawMeta = plan.toStringMeta();
      const strippedMeta = rawMeta != null ? stripAnsi(rawMeta) : null;
      const meta =
        concise && strippedMeta ? squish(strippedMeta) : strippedMeta;
      const isUnbatched = typeof (plan as any).unbatchedExecute === "function";

      const polyPaths = pp(plan.polymorphicPaths);
      const polyPathsIfDifferent =
        plan.dependencies.length === 1 &&
        pp(plan.dependencies[0].polymorphicPaths) === polyPaths
          ? ""
          : `\n${polyPaths}`;

      const planString = `${planName}[${plan.id}${`∈${plan.layerPlan.id}`}]${
        meta ? `\n<${meta}>` : ""
      }${polyPathsIfDifferent}`;
      const [lBrace, rBrace] =
        plan instanceof __ItemStep
          ? ["[/", "\\]"]
          : plan.isSyncAndSafe
          ? isUnbatched
            ? ["{{", "}}"]
            : ["[", "]"]
          : ["[[", "]]"];
      const planClass = plan.hasSideEffects
        ? "sideeffectplan"
        : plan instanceof __ItemStep
        ? "itemplan"
        : isUnbatched && !plan.isSyncAndSafe
        ? "unbatchedplan"
        : "plan";
      graph.push(
        `    ${planNode}${lBrace}${mermaidEscape(
          planString,
        )}${rBrace}:::${planClass}`,
      );
    }
    return planIdMap[plan.id];
  };

  graph.push("");
  graph.push("    %% define steps");
  operationPlan.processSteps(
    "printingPlans",
    0,
    "dependencies-first",
    (plan) => {
      planId(plan);
      return plan;
    },
  );

  graph.push("");
  graph.push("    %% plan dependencies");
  const chainByDep: { [depNode: string]: string } = {};
  operationPlan.processSteps(
    "printingPlanDeps",
    0,
    "dependencies-first",
    (plan) => {
      const planNode = planId(plan);
      const depNodes = plan.dependencies.map(($dep) => {
        return planId($dep);
      });
      const transformItemPlanNode = null;
      // TODO: bucket steps need to be factored in here.
      /*
      plan instanceof __ListTransformStep
        ? planId(
            steps[operationPlan.transformDependencyPlanIdByTransformStepId[plan.id]],
          )
        : null;
        */
      if (depNodes.length > 0) {
        if (plan instanceof __ItemStep) {
          const [firstDep, ...rest] = depNodes;
          const arrow = plan.transformStepId == null ? "==>" : "-.->";
          graph.push(`    ${firstDep} ${arrow} ${planNode}`);
          if (rest.length > 0) {
            graph.push(`    ${rest.join(" & ")} --> ${planNode}`);
          }
        } else {
          if (concise && plan.dependents.size === 0 && depNodes.length === 1) {
            // Try alternating the nodes so they render closer together
            const depNode = depNodes[0];
            if (chainByDep[depNode] === undefined) {
              graph.push(`    ${depNode} --> ${planNode}`);
            } else {
              graph.push(`    ${chainByDep[depNode]} o--o ${planNode}`);
            }
            chainByDep[depNode] = planNode;
          } else {
            graph.push(`    ${depNodes.join(" & ")} --> ${planNode}`);
          }
        }
      }
      if (transformItemPlanNode) {
        graph.push(`    ${transformItemPlanNode} -.-> ${planNode}`);
      }
      return plan;
    },
  );

  graph.push("");
  if (!concise) graph.push("    subgraph Buckets");
  for (let i = 0, l = operationPlan.stepTracker.layerPlans.length; i < l; i++) {
    const layerPlan = operationPlan.stepTracker.layerPlans[i];
    if (!layerPlan || layerPlan.id !== i) {
      continue;
    }
    const plansAndIds = Object.entries(steps).filter(
      ([id, plan]) =>
        plan && plan.id === Number(id) && plan.layerPlan === layerPlan,
    );
    const raisonDEtre =
      ` (${layerPlan.reason.type})` +
      (layerPlan.reason.type === "polymorphic"
        ? `\n${layerPlan.reason.typeNames}`
        : ``);
    const outputMapStuff: string[] = [];
    graph.push(
      `    Bucket${layerPlan.id}(${mermaidEscape(
        `Bucket ${layerPlan.id}${raisonDEtre}${
          layerPlan.copyPlanIds.length > 0
            ? `\nDeps: ${layerPlan.copyPlanIds
                .map((pId) => steps[pId].id)
                .join(", ")}\n`
            : ""
        }${pp(layerPlan.polymorphicPaths)}${
          layerPlan.rootStep != null && layerPlan.reason.type !== "root"
            ? `\nROOT ${operationPlan.dangerouslyGetStep(
                layerPlan.rootStep.id,
              )}`
            : ""
        }${startSteps(layerPlan)}\n${outputMapStuff.join("\n")}`,
      )}):::bucket`,
    );
    graph.push(
      `    classDef bucket${layerPlan.id} stroke:${color(layerPlan.id)}`,
    );
    graph.push(
      `    class ${[
        `Bucket${layerPlan.id}`,
        ...plansAndIds.map(([, plan]) => planId(plan)),
      ].join(",")} bucket${layerPlan.id}`,
    );
  }
  for (let i = 0, l = operationPlan.stepTracker.layerPlans.length; i < l; i++) {
    const layerPlan = operationPlan.stepTracker.layerPlans[i];
    if (!layerPlan || layerPlan.id !== i) {
      continue;
    }
    const childNodes = layerPlan.children.map((c) => `Bucket${c.id}`);
    if (childNodes.length > 0) {
      graph.push(`    Bucket${layerPlan.id} --> ${childNodes.join(" & ")}`);
    }
  }
  if (!concise) graph.push("    end");

  const graphString = graph.join("\n");
  return graphString;
}

function pp(polymorphicPaths: ReadonlySet<string>) {
  if (polymorphicPaths.size === 1 && polymorphicPaths.has("")) {
    return "";
  }
  return [...polymorphicPaths].map((p) => `${p}`).join("\n");
}

function startSteps(layerPlan: LayerPlan) {
  function shortStep({ step }: { step: ExecutableStep }) {
    return `${step.constructor.name?.replace(/Step$/, "") ?? ""}[${step.id}]`;
  }
  function shortSteps(steps: Array<{ step: ExecutableStep }> | undefined) {
    if (!steps) {
      return "";
    }
    const str = steps.map(shortStep).join(", ");
    if (str.length < 40) {
      return str;
    } else {
      return steps.map((s) => s.step.id).join(", ");
    }
  }
  return layerPlan.phases.length === 1
    ? ``
    : `\n${layerPlan.phases
        .map(
          (phase, i) =>
            `${i + 1}: ${shortSteps(phase.normalSteps)}${
              phase.unbatchedSyncAndSafeSteps
                ? `\n>: ${shortSteps(phase.unbatchedSyncAndSafeSteps)}`
                : ""
            }`,
        )
        .join("\n")}`;
}
