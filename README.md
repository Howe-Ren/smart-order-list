### instance 
1.A 1 (Manual style first)
1.B 2 (Primary Smart List)
1.C 3 (Consecutive List)
- 4 (Consecution Exit Mechanism)
1.1 5 (Shuffle initial and manual prefix)
	1.1.1 6 (Numerals first, Smart Nested List)
1.2 7 (Auto refresh)

### Insight 
---
1. Proactive behavior 
	1.1 Manual #Style 
	1.2 Intermediate prefix (uninitial) #Silence 
	1.3 `\` before `.` #Silence 
	1.4 Double `Enter` #Silence 
2. Passive behavior 
	2.1 `Tab` #Style 
	2.2 Single `Enter` #Style 

### Issue 
---
#### 1. Nested list style shouldn't influence parent list #issue 
##### instance_1 
---
> couldn't apply checkbox style in nested list 
###### outcome 
1. 1
	1.1 2
		- [ ] 3
###### expected 
- [ ] 3

##### instance_2
---
###### step_0
1. 1
	1.1 2
		1.1.1 3
		1.1.2 4
###### step_1
- turn third line to checkbox list
###### outcome 
1. 1
	1.1 2
		- [ ] 1.1.1 3
		1.1.1 4
> the following forth line list is influenced 


### Feature 
---
- Styles 
	- Grey-background list's prefix 
	- Supporting
		1. Numerals (prior)
			- [-] Normal, <span style="color:grey">0</span>-9 #mixable 
			- [-] Parenthesized, <span style="color:grey">(0)</span>-(9)
		1. Alphabet 
			- [-] Uppercase, A-Z #mixable 
			- [-] Lowercase, a-z #mixable 
		1. Chinese numerals 
			- [-] Classic, 一、... 九、
		1. Roman Numerals 
			- [ ] Classic, I-II
				- Effect for manual "I" only i.e. not "I" after "H" 
	- Limitation 
		- [ ] One alphabet per digit 
			- Fix "instance. " 
		- [ ] Prefix Length maximum 
			- Forbid "instance. " etc from stylizing 
		- [ ] Single list type 
			- Either Unordered list or Ordered list 
		- [ ] Mixture  
			- Numeral and Alphabet only 
- Consecutive List 
	- [-] Auto refresh sequence
		- Shuffle both **initial** and **manual** prefixes 
			- [ ] Forbid prepending Chorus prefixes above Duo? but "e.g."?
		- Parallel style 
		- Nested-parental prefix 
	- ==Exit== Mechanism triggers 
		- [-] Parallel **Codeblock "\`\`\`", "\~\~\~"**
			- Otherwise the manual list in Codeblock would disorder authentic list's sequence 
			- [ ] ==Ban== auto-style in Codeblock 
				- Respect Raw Codes 
		- [-] **Headling "###"** 
		- [-] **Dividing Line "---"** 
		- [-] **Unordered List** (bullet list)
	- ==Maintain== Mechanism 
		- [-] **Plain Line** (nonList)
