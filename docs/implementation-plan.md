# Order of Operations

This is going to be a pretty substantial project, so I want to make sure we implement it in the right order. After creating the git repo and wiring the frontend to stubs, we should prioritize the core functionality and build out from there. 

# Phase 1: Library

All of our other functionality is based on the ability for our code to interface with Google Drive files. We need to do the following:

- [x] Build logic for connecting app to Google Drive  
- [x] Set up OAuth so users can securely link their accounts  
- [x] Ensure that frontend accurately reflects structure of user’s Drive folder  
- [x] Ideally we can get live updates to the Library; manually syncing with Drive is friction that I want to avoid

For now, we won’t track stuff like Claims, Last Verified, Conflicts, etc. We’ll have Status set to **Unverified** for all files. Clicking on a file will open a sidebar with some metadata, including a link to the document itself; with nothing selected the sidebar is closed rather than empty.

In terms of scope, we’ll keep things focused on just document files. We’ll ignore slides, images, and spreadsheets for now.

The Library shows what is in the Drive folder *now*. Documents that are deleted, trashed, or moved out are soft-deleted in the database so their claims survive, but they are not listed anywhere in the Library — a vanished document becomes visible as a flag on the claims that cite it, in Phase 2. See decisions §7a.

# Phase 2: Creating Claims

This phase has two parts: building the ontology and AI-powered Claim generation. To stay focused, we’ll defer consistency checking until after the base Claim system is properly established.

## Building the Ontology

For claims to be made, we need to have the ontology in place first. This will include an entity matcher helper that we can use to normalize outputs from the LLM in our Claim Generation step.

- [ ] Set up PSQL DB  
- [ ] Seed with starting Entities and Claims (link to documents)  
- [ ] Create basic entity matcher function  
- [ ] Wire up Claims––both table and graph views––on frontend to visualize everything (users should have the ability to define and edit Claims via the frontend)

## Claim Generation

To generate claims, we’ll have an LLM read a document and create a structured output we can then parse into our Claims table. 

- [ ] Set up LLM to extract claims from documents  
- [ ] Evaluate different models on long documents to determine the best tool for the job  
- [ ] Wire up frontend buttons to LLM generation  
- [ ] Wire up Library to show Verified status and number of Claims associated with each document  
- [ ] Flag claims whose source document has been removed from the Library, and surface them (decisions §7a). This is the replacement for Phase 1’s All/Removed toggle and needs no contradiction detection, so it lands here rather than in Phase 3  
- [ ] Set up scheduled runs to file claims while we’re away so we can passively fill the DB

To avoid getting rate-limited, we won’t support a button that lets the user process the entire project all at once. 

# Phase 3: Conflict Adjudication

With support for Claims implemented, we can add conflict-detection. Basically, if two Claims involve the same subject and relationship/attribute but different objects/values, we get a collision. Some of these might not be collisions, so we’ll want to gate carefully (e.g. a state might have two different rulers at two different times and a character might have multiple spouses depending on their culture).

- [ ] Implement system for finding all conflicts in our Claims table  
- [ ] Fold the vanished-source flag from Phase 2 into the Conflicts view as a distinct conflict kind, alongside the contradictory-value kind  
- [ ] Wire up logic to surface conflicts to the user  
- [ ] Wire up logic to resolve conflicts (either choose one or manually/generatively incorporate one into the other)  
- [ ] Wire conflicts into Library and Claims frontend components

# Phase 4: Assistant

Here we define the one agentic piece of our project. The Assistant can read the DB, chat with citations to documents, extract Claims from Unverified documents, propose new Claims, and write to Markdown files that can be applied to Google Drive. The user should also be able to tag documents and entities, and provide external files for further context. We may also want to give the Assistant a web-search tool so it can research new topics.

- [ ] Implement basic chatbot  
- [ ] Integrate tools and other connectors  
- [ ] Evaluate different models to determine the best tool for the job

# Phase 5: Polish

After the core functionality is built, I want to release this thing on Vercel so it’s out before we start iterating on additional features. 

- [ ] Create a homepage  
- [ ] Clean up any questionable UI or buggy behaviors  
- [ ] Deploy