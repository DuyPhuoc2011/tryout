export interface ScenarioCompanyContext {
  name: string;
  product: string;
  team: string;
  user_role: string;
}

export interface ScenarioTicket {
  id: string;
  title: string;
  body: string;
}

export interface ScenarioAgentPrompt {
  system: string;
}

export interface ScenarioGroundTruth {
  solution_notes: string;
  red_flags: string[];
}

export interface ScenarioRubricCriterion {
  id: string;
  weight: number;
  description: string;
}

export interface ScenarioRubricDimension {
  weight: number;
  criteria: ScenarioRubricCriterion[];
}

export interface ScenarioRubric {
  technical: ScenarioRubricDimension;
  professional: ScenarioRubricDimension;
}

/**
 * The subset of the scenario `definition` JSONB that the app reads.
 * The full authored definition has more fields (clarifications, etc.);
 * those are typed as `unknown` here until a later milestone needs them.
 */
export interface ScenarioDefinition {
  title: string;
  company_context: ScenarioCompanyContext;
  ticket: ScenarioTicket;
  agent_prompts: {
    pm_mai: ScenarioAgentPrompt;
    senior_alex: ScenarioAgentPrompt;
  };
  ground_truth: ScenarioGroundTruth;
  rubric: ScenarioRubric;
}
