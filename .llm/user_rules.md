CURRENT STAGE: DEVELOPMENT

# Stage rules
## Development
- No backward compatibility code
- No DB/configs migration code
- No checking for token/password reliability. If it's "change-me", it's OK

# Coding style
## Concise and Clear, Not Spaghetti Code

Always write concise code. The code should be understandable at first glance, like:

min_signal = min(sum(x['signal'] for x in logs['signals'], []))

Avoid spaghetti code such as:

min_signal = 10000
for signals in logs.get('signals', None):
    if signals is None:
        ...

## Understand Context, Check Examples, and Reuse Code
Always ensure you fully understand the context of existing code. Pay attention to my coding style and error handling patterns. Whenever I ask you to do something, first look at examples of how similar tasks are currently implemented in the repository.

# Omit 99% of Comments in Code
Never add unnecessary comments like:
signals = logs.get('signals', None)  # check if signals are present
Do NOT add such comments. The code itself clearly shows the intention, and comments like these are redundant.

## Make Minimal Code Changes
Avoid major rewrites of the codebase. Stick to minimal interventions. If you ever feel a significant refactoring is required, discuss it with me first, and proceed step-by-step, asking for confirmation at each stage to ensure we're moving in the correct direction.

## Always prefer to use modern libraries to achieve goals. Instead of re-implementing any code from scratch, always try to recall existing well-designed library for this and use it instead (e.g. python-telegram-bot for bot api, pydantic for models validation, beanie as mongo ORM, lightllm for LLM api access, more-itertools for complex iterables etc)

# Planning
Important!!!
Do not write code right away!
Instead, keep to the following plan:

1. Ask me few questions to make sure you understand my request fully. Also ask questions whenever you see it is very dangerous to implement some of my requests (it might break some functionality or introduce a bug).  For each of your questions provide default answer if possible so that I can just skip obvious questions if I want. Format as Q1. <question text> [DEFAULT: <default answer>]

2. After I answered, give me 2-3 differenet optimal plans how you gonna proceed with feature. Do NOT apply changes to my code right away. Format as # Plan A ... # Plan B

3. Once we polished the plan together, I will give you permission to make code edits and then you go and implement selected plan. When I tell GO! this means you should proceed with:
 - creating todo list
 - implementing code edits right away accroding to plan

# User (Me) is Smarter Than AI (You)
If you ever have doubts or anticipate substantial changes, always consult me first. My insights will be more valuable and aligned with our goals than your autonomous decisions.