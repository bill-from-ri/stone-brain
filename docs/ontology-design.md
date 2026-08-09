# Stone Brain Ontology

The root of this project is an ontology system that lets us store atomic claims about relationships between entities in our world. We’ll start the project with a basic set of entities and relationships. Here’s the list of entity types:

* Characters  
* Factions  
* Societies  
* Cultures  
* Religions  
* Settlements  
* Regions  
* Artifacts  
* Events

With all our entities in order, we’ll have to define a Claims table that encodes (1) relationships between various entities and (2) attributes of individual entities. Relationships need to be directional (symmetric relationships will therefore have 2 claims each) and each should only contain 2 entities. Every relationship claim will have the following fields:

* Subject\_id  
* Subject\_type  
* Object\_id  
* Object\_type  
* Relationship  
* Start\_date 	(nullable)  
* End\_date 	(nullable)  
* Sources  
* Canonicity 	(canon | draft)

Attribute claims will look mostly the same, but instead of a Relationship and an Object, we’ll have an Attribute and a set of typed Value fields. 

* Subject\_id  
* Subject\_type  
* Value\_Int 	(nullable)  
* Value\_Date 	(nullable)  
* Value\_String 	(nullable)  
* Value\_Float 	(nullable)  
* Attribute  
* Start\_date 	(nullable)  
* End\_date 	(nullable)  
* Sources  
* Canonicity 	(canon | draft)

**Note:** Depending on what fields we assign to entities, we could get away with a single Entities table instead of the 10 we defined at the start. Each would only have  a name, name\_variants, and potentially a source doc field. All other information about an entity would be encoded in a Claim. 

With just an Entities table, there would be no need for entity\_type fields in either of the Claims tables.