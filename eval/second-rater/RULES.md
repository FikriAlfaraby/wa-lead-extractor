# Labelling rules for the second rater

Each item is one fact that a model extracted from a WhatsApp conversation between a property agent and a
lead, and that an automatic scorer counted as invented because it did not match the answer key exactly.
Your job is to say, for each item, whether the extracted fact is right, wrong or debatable, judged
against the conversation.

## The fields

- **budgetIDR**: the lead's budget, in rupiah.
- **areas**: the places where the lead wants the property.
- **intent**: whether the lead wants to buy or to rent.
- **urgency**: how soon the lead needs it: high, medium, low, or unknown when the lead does not say.
- **propertyType**: the kind of property the lead wants.
- **timeline**: when the lead wants to buy or move in, in the lead's own words.

## The labels

- **right**: the extracted value says what the lead said. Other words, a translation, more or less
  detail than the answer key, or an extra detail the lead did say are all still right.
- **wrong**: the extracted value says something the lead did not say, or contradicts what the lead
  said: a guessed value, a fact about another person, a date for something other than the purchase or
  the move, a place the lead did not ask for.
- **debatable**: the lead's words leave the field open, and a careful labeller could reasonably write
  either the extracted value or the answer key's value.

## How to judge

1. Only the lead's own messages count as evidence. What the agent says, or what the lead says about a
   friend or a relative, is not a fact about the lead.
2. The answer key is one labeller's reading, not the truth. Do not prefer it by default.
3. Read the whole conversation before labelling an item from it.
4. Give one label per item and one sentence of reason that quotes the lead's words you relied on.

## Output

A JSON array, one object per item, in the order of `items.json`:
`{"id": "i01", "label": "right" | "wrong" | "debatable", "why": "..."}`
