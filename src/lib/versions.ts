/** Step 69: one registry of every deterministic rule-set version. Bump the module constant when its rules change. */
import { SAFETY_POLICY_VERSION } from "./safety";
import { INTERVENTION_POLICY_VERSION } from "./intervention";
import { TRAINING_POLICY_VERSION } from "./training";
import { NUTRITION_POLICY_VERSION } from "./nutrition-engine";
import { CARDIO_POLICY_VERSION, MOBILITY_POLICY_VERSION } from "./movement";
import { WELLNESS_RULE_VERSION } from "./wellness";
import { RECOVERY_MODE_VERSION } from "./recovery-mode";
import { VERIFICATION_POLICY_VERSION } from "./verification";
import { OUTCOME_POLICY_VERSION } from "./outcomes";
import { KNOWLEDGE_POLICY_VERSION } from "./knowledge";
import { EXPERIMENT_POLICY_VERSION } from "./experiments";
import { BEHAVIOUR_MODEL_VERSION } from "./behaviour-model";
import { REWARD_POLICY_VERSION } from "./reward";

export const SCHEDULER_VERSION = "scheduler_v1";

export const ENGINE_VERSIONS = {
  scheduler: SCHEDULER_VERSION,
  safety: SAFETY_POLICY_VERSION,
  intervention: INTERVENTION_POLICY_VERSION,
  training: TRAINING_POLICY_VERSION,
  nutrition: NUTRITION_POLICY_VERSION,
  cardio: CARDIO_POLICY_VERSION,
  mobility: MOBILITY_POLICY_VERSION,
  wellness: WELLNESS_RULE_VERSION,
  recovery: RECOVERY_MODE_VERSION,
  verification: VERIFICATION_POLICY_VERSION,
  outcomes: OUTCOME_POLICY_VERSION,
  knowledge: KNOWLEDGE_POLICY_VERSION,
  experiments: EXPERIMENT_POLICY_VERSION,
  behaviour: BEHAVIOUR_MODEL_VERSION,
  reward: REWARD_POLICY_VERSION,
} as const;

/** Versions stamped on every plan proposal so its history stays explainable after rules change. */
export const PLAN_ENGINE_VERSIONS = {
  scheduler: SCHEDULER_VERSION,
  safety: SAFETY_POLICY_VERSION,
  training: TRAINING_POLICY_VERSION,
  nutrition: NUTRITION_POLICY_VERSION,
  recovery: RECOVERY_MODE_VERSION,
};
