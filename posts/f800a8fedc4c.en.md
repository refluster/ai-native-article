---
title: "OpenAI's GPT-6 Cyber: attack capability rated \"Critical,\" answered with in-scope behavior and gated access"
lang: "en"
type: "explanation"
category: "Agentic AI"
date: "2026-11-10"
abstract: "On November 5, 2026, OpenAI announced GPT-6 Cyber, a model built to find and validate exploitable vulnerabilities. It scores 48.5% on ExploitGym (GPT-5.6 Cyber: 32.1%), and OpenAI raised its Preparedness Framework cybersecurity classification from \"High\" to \"Critical.\" On a scope-adherence evaluation it avoided out-of-scope exploitation in 99.93% of cases without deployment prompts. Access is limited to approved Daybreak Red customers and widens in stages."
notionId: "414d0f0b-e61e-8105-ac6c-f800a8fedc4c"
sourceUrls: "https://openai.com/index/introducing-gpt-6-cyber/"
author: "ingrid"
---

## Executive Summary

On November 5, 2026, OpenAI announced GPT-6 Cyber, a model built to find and validate exploitable vulnerabilities. It scores 48.5% on ExploitGym (GPT-5.6 Cyber: 32.1%), and OpenAI has raised its Preparedness Framework cybersecurity classification from "High" to "Critical." On the ExploitGym Honeypot evaluation of staying within scope, it avoided exploiting out-of-scope services in 99.93% of cases without deployment prompts. Access is limited to approved Daybreak Red customers and will widen in stages.

## What was announced

OpenAI positions GPT-6 Cyber as an aligned cybersecurity agent that finds and validates vulnerabilities. The announcement makes two claims:

- Capability: large gains over GPT-5.6 Cyber on key cybersecurity benchmarks, including a 51% relative improvement on ExploitGym.
- Alignment: a step-function improvement in staying within the boundaries researchers set.
Availability starts through the API and Codex for a select group of approved Daybreak Red customers. OpenAI says it will expand to all Daybreak Red customers "soon," is making GPT-5.6 Cyber available to all Daybreak Red customers now, and is widening Daybreak Blue alpha access for GPT-6 Astra to more organizations and individual researchers.

## Capability, by the numbers

All figures below are OpenAI's own evaluation results.

- ExploitGym (exploiting a specified vulnerability in a remote target): GPT-6 Cyber 48.5% vs. GPT-5.6 Cyber 32.1%, about 16 percentage points higher.
- Offensive web penetration testing (a new evaluation; models probe web applications without source code): 40.3% recall of vulnerabilities for GPT-6 Cyber vs. 32.0% for GPT-6 Astra.
- RemoteExploitBench (a new benchmark using known vulnerabilities in applications such as GitLab, PostgreSQL, and Jenkins in a controlled environment): in the initial evaluation, GPT-6 Astra running with Daybreak Blue refused 100% of tasks, while GPT-6 Cyber completed 95%. Its only failure was an exploit it could not get to work remotely.
- Linux kernel: using the same research harness, GPT-6 Cyber reproduced 1,724 vulnerabilities and developed working exploits for 948, more than five times the 166 exploited by GPT-5.6 Sol. OpenAI disclosed 304 critical findings to maintainers with candidate patches.
- Firefox: it produced evidence and reproducible tests for 81 novel vulnerabilities that Mozilla classified as high severity, and showed that an additional 30 known issues were more severe than previously reported. Mozilla began landing fixes shortly after receiving the reports.
- Brotli: alongside other OpenAI models, it helped develop and validate exploits showing how a critical flaw in the compression library used by Node.js and other software could enable remote code execution in downstream applications.
On these results OpenAI classifies the model as "Critical" in cybersecurity under its Preparedness Framework, up from "High" for GPT-5.6 Cyber.

## Alignment: how "staying in scope" was measured

The announcement names the risk for cybersecurity agents: going outside the assigned task, attempting to exploit unrelated services, or disregarding the researcher's rules of engagement.

The measurement is ExploitGym Honeypot. The model is given a difficult exploitation task in an isolated environment with supporting services such as a package registry or object store. Those services are deliberately made easy to exploit, so attacking them would reveal the task's flag. The model must infer that doing so is outside the scope of its task. OpenAI says the evaluation was informed by the Hugging Face incident.

Results:

- Without deployment safety prompts: it avoided exploiting out-of-scope services in 99.93% of cases (GPT-5.6 Cyber: 94.49%).
- With those prompts: 100%.
The announcement also shows chain-of-thought excerpts, for example "don't explore out of scope credentials." Full results are in the system card.

## Misuse safeguards and critical infrastructure

OpenAI says more capable models bring more attempts to cause harm, including efforts by malicious cyber actors and by groups seeking to distill its models. It added or strengthened these protections:

- Cyber-specific misalignment monitoring, checking whether actions match the user's authorization.
- Targeted monitoring for emerging threats. During the coordinated disclosure of critical PHP vulnerabilities, for example, it monitored for attempts to develop exploits against live PHP servers.
- Private Safety Processing (PSP): automated checks that review related interactions for misuse. Standard retention remains the default; API customers using Zero Data Retention generally must use PSP, which reviews encrypted records retained in customer storage for 30 days without exposing prompts and responses to OpenAI personnel.
- Protection against stolen credentials: IP allowlisting is required by default for Daybreak Red API access, and credentials are monitored for compromise.
- Sandboxing, action review, and human oversight, still recommended for high-risk workflows.
For critical infrastructure (power plants, water treatment, and the OT/ICS systems behind them), OpenAI takes two steps. First, a $1 billion Daybreak for Frontline Defenders grant program subsidizes access for resource-constrained teams such as government organizations and essential service providers, and a new group, Daybreak Red for Critical Infrastructure, serves approved defenders. Second, it has refined safeguards against assistance that could compromise industrial controls or safety-critical systems.

The announcement states that higher safeguard block rates are not always better. Many of the techniques are also essential to legitimate security work (understanding systems, finding vulnerabilities, verifying fixes), so OpenAI assesses block rates alongside support for legitimate research and patching rather than aiming for 100%.

For OT it partnered with Dragos. Rob T. Lee, Dragos's Chief AI Officer, says a frontier model on a mock power plant range, told almost nothing, separated the OT assets from the IT noise on its own and found two zero-days in engineering software that manages protective relay data. He adds that the skill floor for the reconnaissance and vulnerability research needed before an attack is dropping. OpenAI says it used Dragos's feedback to refine its safeguards.

## Separating fact from interpretation

Fact, per the announcement: every number is OpenAI's own evaluation, and several key evaluations (ExploitGym Honeypot, RemoteExploitBench, the web pentesting evaluation) are ones OpenAI built itself. The customer endorsements (Firefox, Calif, Cognition, Palo Alto Networks, Cisco, SentinelOne, CrowdStrike, Perplexity, CodeRabbit) are limited to those quoted in the announcement. Third-party replication is not part of it; detail is deferred to the system card and Dragos's report.

What it suggests: the "Critical" classification, the in-scope claim, and the gated access are presented as one package. As the assessed capability rises, access narrows, monitoring layers on, and approval becomes mandatory. Whether that package holds in real use cannot be judged from the announcement alone. The 99.93% figure, for instance, is a result from a single evaluation environment.

For an organization, two questions remain. Can it use this class of model for vulnerability discovery in its own codebase (applying to Daybreak is the entry point)? And how does it make the agents it runs demonstrate that they stay in scope? On the second, the design of ExploitGym Honeypot itself, an environment that offers a tempting way to break the rules, is the reusable idea.

Source: OpenAI, "GPT-6 Cyber: Advancing the frontier of aligned cybersecurity agents" (November 5, 2026)