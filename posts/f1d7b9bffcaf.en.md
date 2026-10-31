---
title: "NVIDIA's OpenShell Reference Architecture: Enforcing Agent Safety in Silicon, Outside the Software Boundary"
lang: "en"
type: "explanation"
category: "Agentic AI"
date: "2026-10-25"
abstract: "On October 21, 2026, NVIDIA announced the OpenShell Reference Architecture, which enforces agent containment in silicon outside the software boundary: Vera Rubin for inference, Vera CPUs for the harness, and Sentry on BlueField-4 for monitoring and quarantine. All figures and partner claims are NVIDIA's own."
notionId: "404d0f0b-e61e-81ec-9358-f1d7b9bffcaf"
sourceUrls: "https://nvidianews.nvidia.com/news/openshell-reference-architecture"
author: "ingrid"
---

## Executive Summary

On October 21, 2026, at GTC Berlin, NVIDIA announced the OpenShell Reference Architecture: Vera Rubin infrastructure for inference, Vera CPUs to run the agent harness, and BlueField-4 DPUs running NVIDIA Sentry to monitor agents and stop them when they step out of bounds. The core idea is to enforce containment in silicon outside the software boundary the agent runs in. Every figure and partner claim below comes from NVIDIA's own press release; no third-party verification is presented.

## What was announced

The announcement describes a reference design for building, containing, observing and enforcing safe agents across enterprise infrastructure and the edge. Its components:

- **NVIDIA Vera Rubin (Vera Rubin NVL72)**: model inference. Described as fungible across pretraining, post-training and inference, with "30x higher throughput per megawatt" for agentic workloads. NVIDIA also names closed and open models built with Nemotron.
- **NVIDIA Vera CPUs**: run the agent harness and tool use, described as delivering "2x the performance of x86 processors with greater energy efficiency". They run open-source **NVIDIA OpenShell**, which provides a secure runtime boundary for autonomous agents.
- **NVIDIA BlueField-4 DPUs with NVIDIA Sentry**: a security framework built on DOCA. It monitors agent behavior continuously, out of band. "If an agent attempts to move outside its software boundary, NVIDIA Sentry quarantines and stops it in milliseconds." Sentry is also said to boost agent capacity by up to 20%.
- **The edge**: extensions through NVIDIA RTX Spark, DGX Spark and DGX Station, for retail, healthcare, manufacturing, robotics, software development and telecommunications.
Availability is stated as "now available."

## The design logic in Jensen Huang's words

"AI capability and safety must advance together," said CEO Jensen Huang, adding that OpenShell was built "to give agents the freedom to do useful work within clearly defined boundaries — contained, monitored and under control." His summary: "agents can think on Rubin, act on Vera and be governed on BlueField."

That is a separation of duties across hardware: one layer thinks, one acts, one governs. Putting governance outside the agent's own software stack means a compromised or misbehaving agent has a harder time taking the governor down with it. This is a reading of the structure of the claim — Sentry acts when an agent leaves its software boundary — not an additional claim from the source.

## Who is doing what (all as stated by NVIDIA)

The partner list is long, but the verbs differ: "working with," "integrating," "exploring." They should be read separately.

- **Operating systems and orchestration**: Linux and Kubernetes from Canonical, SUSE and Red Hat; Microsoft Windows via Microsoft Execution Containers (MXC); cloud operating systems from AWS, Google Cloud and Microsoft Azure.
- **Model builders**: agents from Anthropic, Cohere, Google, Meta, OpenAI, Perplexity, Reflection and SpaceX Super Intelligence can run on OpenShell infrastructure.
- **Security vendors**: 1Password, Check Point, CrowdStrike, Cisco, F5, Fortinet, Microsoft, Okta, Palo Alto Networks, TrendAI and Zscaler are integrating support into their agent security products.
- **Banks**: Europe's BBVA and Santander are working with NVIDIA to explore the architecture as a framework for agent safety, security and governance.
- **Enterprise software**: Cadence, Dassault Systèmes, IBM, SAP, Siemens and Synopsys are building agent platforms on OpenShell; Palantir and NVIDIA are deploying secure agents with customers; SAP is integrating with Joule Studio runtime.
- **ServiceNow**: announced general availability of ServiceNow Arc, a personal long-running agent governed at runtime by its Super Intelligence Control Tower and enforced by OpenShell. Its AI Passport layer carries policy to OpenShell and Sentry, so enterprises "can revoke an AI agent's access across software and hardware within seconds."
- **Hardware and cloud**: Dell Technologies, Cisco, HPE, Lenovo and Supermicro build infrastructure; CoreWeave, Crusoe, Firebird, Firmus, GMI Cloud, IREN, Lambda, Nebius, Nscale, Oracle Cloud Infrastructure and Vultr deploy OpenShell-ready capacity; Baseten, Deepinfra, Fireworks and Together AI integrate it into model development pipelines.
## Reading it: what is fact, what is unverified

**Verifiable from the release**: the date (October 21, 2026), the component names and their division of labor, the partner list, and the stated availability.

**Unverified**: the 30x throughput per megawatt, 2x x86 performance, up to 20% capacity gain, and millisecond quarantine are all NVIDIA's own numbers, with no test conditions given. The depth of each partner's involvement ranges from "integrating" to "exploring" yet is presented as one list. And the release's own disclaimer says many of the products and features described "remain in various stages and will be offered on a when-and-if-available basis," with timing subject to change. "Now available" and that disclaimer sit in the same document; the reader has to weigh them.

## Implication: where the agent-operations question moves

The more durable point is the shift in the question. Agent safety has often been framed as a matter of prompts, model behavior or software guardrails. This reference design frames it as an infrastructure question: who can stop an agent, at which layer, and how fast. The ServiceNow example — revoking access across software and hardware within seconds — is the kind of requirement an operations team can audit against.

Adopting it, however, brings a separate decision: how much dependence on vendor-specific hardware (BlueField-4, Vera) to accept. The reference design presumes NVIDIA's stack, and the release does not say how equivalent enforcement would be achieved outside it.