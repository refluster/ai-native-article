// GENERATED FILE — do not edit by hand.
// Source: workforce/tools/*/{tool.json,system.md}
// Regenerate: node workforce/scripts/build-tool-registry.mjs
//
// The console's view of the registry: everything needed to draw the
// form and the result, and NOT the system prompts (they stay in the
// Lambda's copy — a browser bundle is a publication).

import type { ToolDefinition } from '../types/tool';

export const TOOL_REGISTRY: readonly ToolDefinition[] = [
  {
    "tool_id": "problem-finding",
    "display_name": "Problem Finding",
    "summary": "Decompose an objective into the candidate problems worth solving, each with the evidence that would confirm or kill it.",
    "version": "1.0.0",
    "requires": [
      "azure.openai"
    ],
    "model": {
      "max_tokens": 6000
    },
    "input": {
      "type": "object",
      "required": [
        "objective"
      ],
      "properties": {
        "objective": {
          "type": "string",
          "title": "Objective",
          "description": "The outcome you want, in one sentence. State the end, not the means — \"cut onboarding drop-off\", not \"add a tutorial\".",
          "maxLength": 2000
        },
        "context": {
          "type": "string",
          "title": "Context",
          "description": "What you already know: constraints, prior attempts, who is affected, anything that rules an answer out.",
          "maxLength": 8000
        },
        "method": {
          "type": "string",
          "title": "Decomposition method",
          "description": "How to break the objective down.",
          "enum": [
            "five-whys",
            "first-principles",
            "stakeholder-friction"
          ],
          "default": "five-whys"
        }
      }
    },
    "output": {
      "type": "object",
      "required": [
        "restated_objective",
        "problems"
      ],
      "properties": {
        "restated_objective": {
          "type": "string",
          "description": "The objective restated as the analysis understood it, so a misread is visible before the problems are read."
        },
        "problems": {
          "type": "array",
          "minItems": 3,
          "maxItems": 7,
          "items": {
            "type": "object",
            "required": [
              "statement",
              "why_it_matters",
              "evidence_for",
              "evidence_against",
              "confidence"
            ],
            "properties": {
              "statement": {
                "type": "string",
                "description": "The candidate problem, as a falsifiable claim about the world."
              },
              "why_it_matters": {
                "type": "string",
                "description": "What is lost while this stays unsolved."
              },
              "evidence_for": {
                "type": "string",
                "description": "What is already known that supports this, drawn from the supplied context."
              },
              "evidence_against": {
                "type": "string",
                "description": "What would argue against it, or what is missing that should be there if it were true."
              },
              "next_check": {
                "type": "string",
                "description": "The cheapest observation that would confirm or kill this, and roughly what it costs."
              },
              "confidence": {
                "type": "string",
                "enum": [
                  "low",
                  "medium",
                  "high"
                ]
              }
            }
          }
        },
        "not_the_problem": {
          "type": "array",
          "maxItems": 4,
          "items": {
            "type": "string"
          },
          "description": "Plausible framings deliberately rejected, and why — so the reader can tell what was considered from what was missed."
        }
      }
    }
  },
  {
    "tool_id": "user-research",
    "display_name": "User Research",
    "summary": "Turn a research goal and a segment into an interview guide: what to ask, what each question is testing, and the biases to avoid.",
    "version": "1.0.0",
    "requires": [
      "azure.openai"
    ],
    "model": {
      "max_tokens": 6000
    },
    "input": {
      "type": "object",
      "required": [
        "research_goal",
        "segment"
      ],
      "properties": {
        "research_goal": {
          "type": "string",
          "title": "Research goal",
          "description": "What you need to learn, and what decision it feeds. \"Whether to build X\" is a decision; \"how teams currently do Y\" is a goal.",
          "maxLength": 2000
        },
        "segment": {
          "type": "string",
          "title": "Who you will talk to",
          "description": "The people you can actually reach: role, context, and how they differ from the people you cannot reach.",
          "maxLength": 2000
        },
        "assumptions": {
          "type": "string",
          "title": "Assumptions to test",
          "description": "What you currently believe and would be expensive to be wrong about. One per line.",
          "maxLength": 4000
        },
        "interview_length": {
          "type": "string",
          "title": "Interview length",
          "enum": [
            "15-min",
            "30-min",
            "60-min"
          ],
          "default": "30-min"
        }
      }
    },
    "output": {
      "type": "object",
      "required": [
        "framing",
        "sections",
        "sampling_risk"
      ],
      "properties": {
        "framing": {
          "type": "string",
          "description": "The goal restated as what this guide can and cannot establish, so the reader knows the limits before the first interview."
        },
        "sections": {
          "type": "array",
          "minItems": 3,
          "maxItems": 6,
          "items": {
            "type": "object",
            "required": [
              "title",
              "minutes",
              "questions"
            ],
            "properties": {
              "title": {
                "type": "string"
              },
              "minutes": {
                "type": "integer",
                "minimum": 1,
                "maximum": 60
              },
              "purpose": {
                "type": "string",
                "description": "What this section is for; skip it if you are short on time and this is not load-bearing."
              },
              "questions": {
                "type": "array",
                "minItems": 1,
                "maxItems": 6,
                "items": {
                  "type": "object",
                  "required": [
                    "ask",
                    "testing"
                  ],
                  "properties": {
                    "ask": {
                      "type": "string",
                      "description": "The question in the words you would actually say."
                    },
                    "testing": {
                      "type": "string",
                      "description": "The assumption or unknown this question is aimed at."
                    },
                    "follow_up": {
                      "type": "string",
                      "description": "The probe to use when the first answer is generic."
                    },
                    "listen_for": {
                      "type": "string",
                      "description": "The specific signal in an answer that would change your mind."
                    }
                  }
                }
              }
            }
          }
        },
        "avoid": {
          "type": "array",
          "maxItems": 6,
          "items": {
            "type": "object",
            "required": [
              "question",
              "why"
            ],
            "properties": {
              "question": {
                "type": "string",
                "description": "A tempting question that would produce misleading data."
              },
              "why": {
                "type": "string",
                "description": "The bias it introduces — leading, hypothetical, or self-report where behaviour is needed."
              }
            }
          }
        },
        "sampling_risk": {
          "type": "string",
          "description": "Who this segment excludes, and which conclusions would be unsafe as a result."
        }
      }
    }
  }
];
