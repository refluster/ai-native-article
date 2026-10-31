---
title: "NVIDIA's OpenShell Reference Architecture: Enforcing Agent Safety in Silicon"
lang: "en"
type: "explanation"
category: "AI Infrastructure"
date: "2026-10-26"
abstract: "NVIDIA's OpenShell Reference Architecture separates inference (Vera Rubin), agent execution (Vera CPUs) and monitoring and enforcement (Sentry on BlueField-4), moving agent safety from a software boundary to in-silicon enforcement. All figures and partner claims are NVIDIA's own; none is independently verified."
notionId: "405d0f0b-e61e-816b-aaca-cef5c7e1c1f0"
sourceUrls: "https://nvidianews.nvidia.com/news/openshell-reference-architecture?utm_source=chatgpt.com"
author: "ingrid"
---

## Executive Summary

On October 21, 2026, at GTC Berlin, NVIDIA announced the OpenShell Reference Architecture. It assigns inference to Vera Rubin, agent execution to Vera CPUs, and monitoring and enforcement to NVIDIA Sentry running on BlueField-4 DPUs, moving agent safety from a software boundary to in-silicon enforcement. The notable part is less the performance figures than the design principle: the machine that runs the agent and the machine that polices it are physically separate. Every figure and partner claim here comes from NVIDIA's own announcement; the document offers no third-party verification.

## What was announced (evidence)

According to the release, the OpenShell Reference Architecture enables "building, containing, observing and enforcing safe agents on enterprise infrastructure and edge systems." It builds on NVIDIA OpenShell secure runtime software and extends it into full-stack infrastructure. It has four layers.

- **NVIDIA Vera Rubin:** model inference, including closed and open models built with NVIDIA Nemotron, on Vera Rubin NVL72 infrastructure. For agentic workloads the release claims "30x higher throughput per megawatt."
- **NVIDIA Vera CPUs:** agent harnesses and tool use. The release claims "2x the performance of x86 processors with greater energy efficiency." They run open source NVIDIA OpenShell, "a secure runtime boundary for autonomous agents."
- **NVIDIA BlueField-4 DPUs with NVIDIA Sentry:** built on NVIDIA DOCA, Sentry provides continuous out-of-band monitoring of agent behavior and in-silicon policy enforcement. If an agent attempts to move outside its software boundary, the release says Sentry "quarantines and stops it in milliseconds." Sentry also "boosts agent capacity by up to 20%."
- **Edge:** NVIDIA RTX Spark, DGX Spark and DGX Station extend the architecture to agents in retail, healthcare, manufacturing, robotics, software development and telecommunications.
Supported operating environments include Linux and Kubernetes infrastructure from Canonical, SUSE and Red Hat, and Microsoft Windows using Microsoft Execution Containers (MXC). It can run on cloud operating systems from Amazon Web Services, Google Cloud and Microsoft Azure. Availability is a single sentence, "now available"; no pricing or shipment detail is given.

Jensen Huang's quote compresses the design: "agents can think on Rubin, act on Vera and be governed on BlueField." He also said that as enterprises prepare to deploy "billions of AI agents," safety and control must be built into the computing architecture.

## Who is on board (evidence)

- **Model builders:** Anthropic, Cohere, Google, Meta, OpenAI, Perplexity, Reflection and SpaceX Super Intelligence agents can run on OpenShell infrastructure.
- **Security vendors:** 1Password, Check Point, CrowdStrike, Cisco, F5, Fortinet, Microsoft, Okta, Palo Alto Networks, TrendAI and Zscaler are integrating support into their agent security products.
- **Banks:** Europe's BBVA and Santander are working with NVIDIA to "explore" the architecture as a framework for agent safety, security and governance.
- **Software:** Cadence, Dassault Systèmes, IBM, SAP, Siemens and Synopsys are building agent software platforms with OpenShell. Palantir and NVIDIA are working with customers to deploy secure agents in production. SAP is integrating with its Joule Studio runtime, part of SAP Business AI Platform.
- **Systems and cloud:** Dell Technologies, Cisco, HPE, Lenovo and Supermicro build infrastructure; CoreWeave, Crusoe, Firebird, Firmus, GMI Cloud, IREN, Lambda, Nebius, Nscale, Oracle Cloud Infrastructure and Vultr deploy OpenShell-ready infrastructure; Baseten, Deepinfra, Fireworks and Together AI are building integrations into their model development pipelines.
The most concrete case is ServiceNow, which announced general availability of ServiceNow Arc, a personal long-running AI agent. Its actions are governed at runtime by the ServiceNow Super Intelligence Control Tower and enforced by NVIDIA OpenShell. ServiceNow's AI Passport authority layer carries those policies to OpenShell and Sentry, so enterprises can "revoke an AI agent's access across software and hardware within seconds."

## Reading it (conclusions)

What follows is our interpretation of the release's facts, not NVIDIA's claim.

**1. Separating who watches is the core move.** Most agent safeguards have lived inside the same process or runtime as the agent. This design pushes monitoring and enforcement onto separate silicon (BlueField-4), "out-of-band" in the release's words. It brings a classic security advantage to agent operations: a compromised agent does not share an attack surface with its monitor.

**2. Millisecond quarantine assumes no human approval.** A millisecond response leaves no room for human review. The design therefore presumes agents operating autonomously inside predefined boundaries, not per-action sign-off, which matches Huang's phrase "clearly defined boundaries." The quality of the boundary definition becomes the quality of the safety.

**3. Revocation speed is what governance actually is.** In the ServiceNow example the notable capability is not detection but revoking access "within seconds." At billions of agents, stopping them one by one cannot work; you need one place to revoke authority and a path that propagates it to software and hardware. Here AI Passport is the source of policy and OpenShell/Sentry the point of enforcement.

**4. The form, a reference architecture, matters.** This is not a single product launch. Model builders, security vendors, OEMs and clouds appear in one diagram, which suggests an intent to standardize the agent-safety substrate as a common attachment point rather than per-vendor implementations. It is also standardization around NVIDIA hardware.

## What to discount

- "30x," "2x" and "up to 20%" are NVIDIA's numbers. The release does not say what baseline the 30x is measured against or on which workload.
- Much of the language is "working with," "exploring," "integrating." Production adoption by partners cannot be separated from intent; BBVA and Santander are explicitly at the exploration stage.
- The release itself notes that many products and features are offered on a "when-and-if-available basis" and that timing is subject to change. "Now available" sits beside the forward-looking disclaimer.
- Nothing is said about the accuracy of the millisecond stop, false-positive rates, or how policies are written. That is too little to judge the safety claim.
## Practical implication

Before deciding whether to adopt NVIDIA's stack, an organization running autonomous agents should ask whether its own design answers three questions. Is the monitor independent of the agent? Are boundaries defined in advance in machine-readable form? Does revocation reach everywhere in seconds? The OpenShell Reference Architecture is one concrete answer to those three. Whether it works should be judged on third-party evaluation and production track record.