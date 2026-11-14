---
title: "Drug Discovery Has No Magic Wands — Daphne Koller on the Keys-and-Locks Problem in AI Drug Discovery"
lang: "en"
type: "explanation"
category: "AI Strategy"
date: "2026-08-06"
abstract: "In \"Drug Discovery Has No Magic Wands,\" a guest post published on a16z on August 3, 2026, insitro founder and CEO Daphne Koller argues that the premise behind \"build a powerful enough AI and it will cure disease\" is simply false. More than 90% of drugs entering clinical trials fail, and in the large majority of those failures the molecule was engineered just fine — the mechanism it targeted was wrong. The industry is manufacturing keys competently but for the wrong locks. If AI is going to transform drug discovery, it will be by advancing disease understanding itself, not by accelerating molecular design."
notionId: "3b4d0f0b-e61e-81e3-8cc7-ce767dccd5e9"
sourceUrls: "https://x.com/a16z/status/2084303964741542372?s=12&t=JLj57N67SbZn6GQzDkxKag"
author: "ingrid"
---

## Executive Summary

In "Drug Discovery Has No Magic Wands," a guest post published on a16z on August 3, 2026, insitro founder and CEO Daphne Koller argues that the premise behind "build a powerful enough AI and it will cure disease" is simply false. More than 90% of drugs entering clinical trials fail, and in the large majority of those failures the molecule was engineered just fine — the mechanism it targeted was wrong. The industry, in her formulation, is manufacturing keys competently but for the wrong locks. If AI is going to transform drug discovery, it will be by advancing disease understanding itself, not by accelerating molecular design — and that requires biological measurement data orders of magnitude beyond what has been collected.

## Three stages of drug discovery, and where AI has concentrated

Koller begins by decomposing drug discovery into three essential stages:

- **Disease-to-mechanism** — identifying a biological mechanism (a pathway, a target, a molecular interaction) where therapeutic intervention will alter the course of disease in humans.
- **Mechanism-to-drug** — creating a molecular intervention in the right therapeutic modality (a small molecule, antibody, siRNA, gene therapy) that achieves the desired mechanistic effect with acceptable safety and pharmacological properties.
- **Drug-to-patient** — designing a clinical development program that identifies the right patients and assesses the molecule's effects, beneficial as well as adverse.
"The vast majority of AI work in drug discovery has focused on stage 2," she writes. The reason is clear enough: the origin of the AI-magic-wand exuberance was AlphaFold, which she herself calls "a field-defining tour de force." From that starting point came an explosion of AI tools capable of designing novel proteins, small molecules, RNA therapies, and even gene therapies.

Koller does not dispute the achievement. What she disputes is the inference drawn from it.

## "Good keys, wrong locks"

Does progress in stage 2 remove the bottleneck? Koller's answer is no, and she offers two lines of evidence.

First, the historical attacks on "undruggable targets" did not come from AI. The success against KRAS — the quintessential undruggable target — "emerged from decades of structural biology and medicinal chemistry, not AI." She then states it plainly: "as of now, I don't know of a single example of an AI-derived insight that has led to 'drugging the undruggable.'" The biggest step functions came instead from expanding the repertoire of therapeutic modalities — first biologics, then siRNA and antisense oligonucleotides, then gene editing. Each new modality opened a class of targets that was simply inaccessible before.

Second, validated-but-undruggable targets are "a tiny handful in the landscape of unmet need." For the vast majority of diseases without effective treatments, **we have no idea what the right mechanism is**. Here Koller produces the statistic that anchors the essay: more than 90% of drugs that enter clinical trials fail, "a dismal statistic that has barely improved in several decades." And in the large majority of those cases, "the molecule was engineered just fine. The mechanism it targeted was wrong."

Her metaphor carries the argument: "We are doing a pretty good job at manufacturing keys, but they are generally for the wrong locks." Even if AI lets the industry make better keys at an accelerating pace, that will not improve its ability to identify the right locks.

The misallocation shows up in capital as well. **There are currently 38 targets that have over 50 programs against each of them.** "How many variants of GLP-1 do we really need?" she asks. Worse is the disservice to patients: the number of novel targets the industry advances each year fell from **~100 in 2015 to about 30 in 2024**.

## The data chasm — reasoning will not close it

The second magic wand is the expectation that large language models, with super-human reasoning, will connect the dots across the vast published literature of human biology and reason their way to new mechanistic hypotheses. Koller identifies the very strong assumption underneath it: that the scientific community has collected — or will soon collect — enough data about human biology to contain the answer, and that better reasoning is all that is missing.

The reason to doubt that assumption is structural. Human biology spans multiple interconnected layers — DNA, protein, cells, multi-cellular environments, entire organisms — and individual components respond dynamically to even subtle changes in related components or in the environment. Biology was not engineered; it is the product of billions of years of messy, stochastic evolution, which produced staggering variation in genes, cell types, states, and contexts, each behaving in its own way. "There is too much of it, too idiosyncratic, to reason about in the abstract. You have to measure it."

On the scale of what is missing, a16z's post introducing the essay summarizes it as: "The data we need to understand human biology is about 1000x the quantity we've collected." Koller herself presents a back-of-the-envelope table and argues that even restricting attention to cell biology — the layer needed to interrogate mechanism — the space is vast, and it becomes exponentially more vast once you account for a drug being an *intervention*, so that biology must be mapped not only as it is but as it would respond to a perturbation. The largest cell atlases assembled to date span hundreds of millions of cells and "remain orders of magnitude too small to cover this space."

Her assessment of the "Virtual Cell" efforts — pairing large-scale perturbation data with AI to reduce the data-collection burden — is correspondingly bounded. Even the largest of them samples only a vanishing fraction of the possible perturbations, and does so almost entirely in a narrow range of cell lines. More importantly, they do not address the other half of the equation: **relating biological mechanisms to human clinical outcomes.**

The conservation argument sharpens the chasm. The folding of a single protein is a self-contained, highly conserved process — "closer to physics than to biology" — which is why folding models can be trained on sequences from thousands of species. Metabolism involves at least a dozen distinct cell types and may be conserved across mammals. But brain function and dysfunction involve dozens of distinct cellular identities and are exquisitely specialized to humans. Koller's line lands hard: "rodents do not get Alzheimer's disease; non-human primates do not recapitulate ALS." The diseases with the least progress are precisely those that are most human-specific — and therefore those for which the data is most expensive to collect, least available, and most fraught with ethical constraints.

## Agents and scorecards — why the coding success does not port

The third magic wand is swarms of AI agents operating in a closed loop with laboratory automation: formulating hypotheses, directing robots, analyzing results, iterating. The early successes are genuinely beguiling — automated systems have already excelled at tasks like optimizing cell-free protein synthesis and designing antibodies against known targets.

But Koller names the condition that makes agentic iterated optimization work: "agents thrive when there is a fast, accurate, and cheap scorecard to evaluate progress." That is exactly why coding assistants and molecular design tools advanced so rapidly. A compiler immediately verifies whether code will run; the iterative loop with a developer provides rapid feedback on intent. "The closed loop is tight, cheap, and objective."

Drug development is the exact opposite. The ultimate scorecard — whether a drug actually provides therapeutic benefit to a patient — cannot be captured well by computational models or high-throughput assays. "The only true ground truth is a human clinical trial." That loop takes years, costs millions, and is strictly bound by human ethics and living biology. No amount of compute or process optimization changes it.

So the agentic-lab successes are solving problems that look like coding — highly quantitative objectives within a constrained search space — and are "largely beside the point when it comes to predicting whether a drug will actually work in a patient population." As Koller puts it: "You cannot solve the human translation problem by accelerating our ability to optimize the wrong objective function."

## Accelerating the final mile only produces faster failures

The fourth magic wand is compressing the expensive third stage — preclinical testing through clinical trials. Koller's rebuttal is compact: "if you accelerate a pipeline full of drugs aimed at the wrong mechanisms, all you get is faster failures."

She does not dismiss the value on offer here. Predictive toxicology models and AI-drafted regulatory filings can shorten IND-enabling work; patient identification from electronic health records, smarter site selection, and automated data management can trim operational overhead. "These compression levers offer meaningful benefits, and we should absolutely pursue those."

The problem is where they bite. Those gains sit almost entirely within the first two slices of work. The remaining 50% — **in-life biological observation** — "is gated by how fast disease unfolds in a living human." Even a comprehensive AI-driven improvement across everything AI can touch leaves the majority of development time and cost structurally unchanged.

The one pathway that could move even that irreducible clock runs, again, through biological mechanism. An AI-enabled, deep mechanistic understanding of a disease enables the identification of novel clinical readouts serving three purposes: selecting the patients most likely to respond, confirming that the drug is hitting its intended target, and detecting early and reliable signals that it is actually modifying disease biology. Together these let trials enroll the right patients, read out faster, and catch failures earlier — changes that transcend trial operations and transform the trial design itself. "Better trials, in the end, are downstream of better biology."

## Conclusion — "a shorter path to a smaller destination is still a smaller destination"

Koller allows that the four magic wands have real value. Generating molecules quickly can be a significant accelerant, as is reasoning across the vast scientific literature and increasing the efficiency of the scientific process. But her verdict is explicit: these tools are "point solutions that address important problems without altering the fundamentals of our industry."

To fulfill AI's promise for the millions of patients lacking any meaningful treatment, effort must be directed at the problem that really matters: **the identification of biological mechanisms with disease-transforming clinical benefit.** This is arguably the hardest problem in drug discovery, because the only conclusive test of whether a novel mechanism has been correctly identified is a human clinical trial.

There are multiple other paths in the space with shorter timelines and clearer near-term proof points. Those paths are shorter because the problems are more tractable — the feedback loops are faster and the benchmarks are cleaner. Koller's closing judgment is aimed there: "a shorter path to a smaller destination is still a smaller destination" — process improvements for problems we already know how to solve.

For the hundreds of millions of patients for whom no meaningful medicines exist, the difference between a wrong mechanism and the right one is the difference between another devastating clinical failure and a life-altering breakthrough. That harder path, she writes, is the one insitro has elected to take, with more to say about its approach soon.