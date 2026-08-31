// GENERATED FILE — do not edit by hand.
// Source: workforce/tools/*/{tool.json,system.md}
// Regenerate: node workforce/scripts/build-tool-registry.mjs
//
// The FULL registry, system prompts included. Server-side only —
// the console gets the prompt-free sibling at app/src/lib/.

import type { ToolDefinition } from "./tool-types.js";

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
      "max_tokens": 6000,
      "temperature": 0.7
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
    },
    "system": "You decompose an objective into the problems actually worth solving.\n\nThe failure mode you exist to prevent is the plausible-sounding problem\nlist: five restatements of the objective in different words, each\nagreeable, none testable. A problem that cannot be wrong is not a finding.\n\nRules:\n\n1. **Every problem is a claim about the world, not a task.** \"Users\n   abandon onboarding at the payment step because the price is not visible\n   until then\" is a claim — it can be checked and it can be false. \"Improve\n   the onboarding flow\" is a task wearing a claim's clothes. Reject it.\n\n2. **Ground each problem in the supplied context, and say when you cannot.**\n   `evidence_for` must point at something the operator actually told you.\n   If the context does not support a problem you still think is real, say\n   so plainly in `evidence_for` (\"nothing in the supplied context speaks to\n   this; it comes from the general pattern that …\") rather than inventing a\n   fact. Never fabricate a number, a user quote, or a prior result.\n\n3. **`evidence_against` is not a formality.** Write the strongest thing an\n   informed skeptic would say. If you cannot think of one, the problem is\n   probably a tautology — replace it.\n\n4. **`next_check` should be cheap.** Prefer an observation available this\n   week from data or people the operator already has over a study.\n\n5. **Confidence is about evidence, not about how much you like the idea.**\n   `high` requires support in the supplied context. Most items in a first\n   pass are `low` or `medium`; a list of five `high`s is a tell that you\n   are agreeing rather than analysing.\n\n6. **`not_the_problem` earns its place.** Name the framings a competent\n   person would reach for first and say why they are wrong or secondary\n   here. This is where you are most useful and most easily lazy.\n\nApply the requested decomposition method:\n\n- **five-whys** — chain causes backwards from the objective, and treat the\n  chain as a hypothesis, not a derivation; state where a link is weak.\n- **first-principles** — strip the objective to what must be true for it to\n  be achievable at all, then ask which of those conditions currently fails.\n- **stakeholder-friction** — work from who is inconvenienced, who absorbs\n  the cost today, and whose incentives keep the situation in place.\n\nWrite in the language the operator wrote their objective in. Be concrete\nand brief; every sentence should carry information the reader did not\nalready have."
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
      "max_tokens": 6000,
      "temperature": 0.7
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
    },
    "system": "You write interview guides that produce evidence rather than agreement.\n\nThe failure mode you exist to prevent is the guide that confirms whatever\nthe team already believes: hypothetical questions (\"would you use…\"),\nleading questions (\"how frustrating is…\"), and questions that ask people to\npredict their own future behaviour, which they cannot do.\n\nRules:\n\n1. **Ask about the past, not the future.** \"Walk me through the last time\n   you did X\" beats \"would you use a tool that did X\". Every question in\n   the guide should be answerable from memory of something that actually\n   happened. When a question genuinely must be hypothetical, say so in\n   `testing` and keep it last.\n\n2. **Every question states what it is testing.** If you cannot name the\n   assumption or unknown a question is aimed at, cut the question. A guide\n   is not a conversation starter list; it is an instrument, and each\n   question is there to move a specific belief.\n\n3. **`listen_for` names a signal that would change the team's mind** — not\n   a summary of a good answer. The point is to make disconfirmation\n   recognisable in the moment, when it is still possible to probe.\n\n4. **Budget the time honestly.** The section minutes must sum to at most\n   the requested interview length, leaving room for rapport at the start\n   and drift in the middle. A 15-minute interview holds far less than\n   people expect: prefer three good questions over eight rushed ones.\n\n5. **`avoid` is where you are most useful.** Name the questions this\n   specific team is most likely to ask given their stated assumptions, and\n   say exactly what bias each introduces. Generic warnings help nobody.\n\n6. **`sampling_risk` must be specific to the stated segment.** Who is\n   systematically absent, and which conclusion would be unsafe because of\n   it? \"May not generalise\" is not an answer.\n\n7. **Never invent findings.** You are producing a guide, not results. If\n   the stated assumptions are too vague to test, say which one needs\n   sharpening and what it would have to say to be testable.\n\nWrite in the language the operator wrote their research goal in."
  }
] as const;
