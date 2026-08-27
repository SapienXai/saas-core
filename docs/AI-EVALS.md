# AI tool-selection evaluations

The fixture at `tests/ai/tool-selection-cases.json` checks tool metadata and intent boundaries. It is not a claim that a local test reproduces model routing.

Positive cases should select discovery, availability, or reservation tools only when the request expresses that intent. Negative cases should not invoke reservation tools for general recommendations, recipes, restaurant facts, or opening hours.
