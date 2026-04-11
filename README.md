## Preview
![README preview](assets/2026-0412_0043.png)


# 1. Insight 
---
1. Element's consecution is Parallel (cross nest-layer/vertical) and Nested (cross-nest/horizontal) from Upper-Level Line. Check [[Smart Order List/README#2.3 Consecution Principle (interaction)]] 
	1.1 **Parallel Principle** (same-layer nest): Parallel lists apply **self-consistent consecution** with each other in default 
	1.2 **Nest Principle** (higher-grade layer, lower-grade layer) 
2. Proactive behavior 
	2.1 double `Enter` #style 
	2.2 Manual initial #style 
	2.3 Insert `\` before prefix's `.` #silence 
3. Passive behavior 
	3.1 single `Enter` 
	3.2 `Space` 
	3.3 `Tab` 

# 2. Rule 
> Strive to make Rule self-consistent and achieve logical closed loop 
## 2.1 Styles 
### 2.1.1 Element Introduction 
---
> - **Element**, the smallest component of a list's prefix 
> - $Digit = \{\emptyset,1,2,3,4\}$
> - **Prefix**: {Element} + {Digit} 
> - **List**: {Prefix} (Prefix Header) 
> - **Mixture**: `Checkbox`×{Ordered List} (Prefix Header + Prefix Tail) 
> - Line: {List, Mixture} 

| element_id | element_name   | description(&sample)                                                                    | primary_type | scondary_type | variation     | mix_prefix | max_digit | mix_list |
| ---------- | -------------- | --------------------------------------------------------------------------------------- | ------------ | ------------- | ------------- | ---------- | --------- | -------- |
| 1          | **Numeral.1**  | classic #hotkey , 0-9 <br>1. `1.` <br>2. `1.1`  <br>3. `1.1.1` <br>4. `1.1.1.1`         | ordered      | Numeral       | classic       | 1          | 4         | 1        |
| 2          | **Numeral.2**  | parenthesized, 0-9<br>1. `(1)` <br>[[Smart Order List/README#^8b482e\|Nested Prefix Rollback Mechanism]] | ordered      | Numeral       | parenthesized | 0          | 1         | 1        |
| 3          | **Alphabet.1** | uppercase, A-Z<br>1. `A.` <br>2. `A.A` <br>3. `A.A.A` <br>4. `A.A.A.A`                  | ordered      | Alphabet      | uppercase     | 1          | 4         | 1        |
| 4          | **Alphabet.2** | lowercase, a-z<br>1. `a.` <br>2. `a.a` <br>3. `a.a.a` <br>4. `a.a.a.a`                  | ordered      | Alphabet      | lowercase     | 1          | 4         | 1        |
| 5          | **Chinese.1**  | classic<br>1. `一、` <br>[[Smart Order List/README#^8b481e\|Nested Prefix Rollback Mechanism]]             | ordered      | Chinese       | classic       | 0          | 1         | 1        |
| 6          | **Bullet**     | bullet  #hotkey <br>1. `-`                                                              | unordered    | Bullet        | classic       | 0          | 0         | 0        |
| 7          | **Checkbox**   | checkbox #hotkey <br>1. `- [ ]` <br>2. `- [-]` <br>3. `- [x]`                           | unordered    | Checkbox      | classic       | 0          | 0         | 1        |
### 2.1.2 Addition  
- Prefix 
	- Grey-Text-Prefix and Indent-Prefix 
	- Single-Digit: End with `.` 
	- Multi-Digit: `.` should and only separate every two Elements 
	- **Smart Prefix Distance** (Reading mode) 
		- ##### Distance Logic 
			- In 2-digit-prefix layer 
				- 2ch 
			- Latter layer 
				- $Distance = ((num\_element * 1ch) + (num\_dot * 0.3ch)) + 2ch$
- Ordered List 
	- **Digit**, the smallest unit of an Ordered List's Prefix. $Digit = \{1,2,3,4\}$
		- 1 Element in 1 Digit per Prefix 
		- Max 4 digits per prefix: `W.X.Y.Z` 
		- Initialized last-digit is customizable i.e. `1.1` > `1.a` 
	- By Rule, max 3 **element-types** per prefix 
		- element option: `Numeral.1`, `Alphabet.1`, `Alphabet.2`  
- Unordered List 
	- 1 Element per Prefix 
- other tips: 
	- Insert Order in Heading `###` through manipulating *Obsidian Outline* 
	- Manual shuffle relieves disorder 

## 2.2 Item Tree 
### 2.2.1 All items 
---
- Line (247)
	- **List** (parallel&nest) (124)
		1. **Single-Digit** List (single-element) (7)
			- Ordered (5)
			- Unordered (2)
		2. **Multi-Digit** List #mix_prefix #nested (117)
			- Ordered, element: `Numeral.1`, `Alphabet.1`, `Alphabet.2`  
				- Single-Element 
				- Multi-Element 
	- **Mixture** #mix_list (123)
		- `Checkbox`×{Ordered List} (123)
			1. `Checkbox`-{Ordered List} #prepend #unordered (122)
			2. `Numeral.1`-`Checkbox` #append #ordered (1)
- **Digit** is exclusive to Ordered Element, thus Unordered List is Non-Digit 
- **Ordered List** nests beneath Ordered List must be nested prefix, and the new nested digit is customizable (always in digit rule)
- **Mixture's Prefix** consists of *Header* and *Tail* (Tail exclusive to Mixture), check [[Smart Order List/README#2.4.2 Mix_List Permutation (Mixture)]]  
### 2.2.2 Classification 
---
> Better convenient view for various study scenarios 
> Element > **List**, `Checkbox` × {Ordered List} > **Mixture** 
1. By **Digit** 
	1.1 Single-Digit 
	1.2 Multi-Digit 
	1.3 Non-Digit
		- Unordered List 
2. By **Prefix** 
	- Classifier 1
		1. Primary Prefix 
			- List 
			- Mixture 
		2. Multi-Digit Prefix 
			- Ordered List 
			- Mixture 
	- Classifier 2
		1. Ordered Prefix 
			- Ordered List 
			- Mixture
		2. Unordered Prefix
			- Unordered List 
3. By Element primary_type 
	3.1 Ordered 
		- Ordered List 
			- Single-Digit List 
			- Multi-Digit List 
		- Mixture: `Numeral.1`-`Checkbox` 
	3.2 Unordered 
		- Unordered List 
		- Mixture: `Checkbox`-{Ordered List}
4. By Nest 
	4.1 Root Nest 
	4.2 Parent Nest 
	4.3 Child Nest 
5. By Prefix Header and Tail of **Mixture**
	- `Checkbox`×{Ordered List} 
		1. `Checkbox`-{Ordered List} 
			- Checkbox #unordered 
		2. `Numeral.1`-`Checkbox`  
			- Numeral.1 #ordered 
### 2.2.3 Discrimination 
---
1. **Non-Nest Discrimination:** 
$$\text{Non-Nest List} \subsetneq (\text{Single-Digit List} \cap \text{Single-Element List})$$
> Non-Nest List is a strict subset of Single-Digit List, also a strict subset of Single-Element List 

2. **Nest Discrimination:** 
$$\text{Nested Prefix (multi-digit) Line} \subsetneq \text{Nested List}$$
> Nested Prefix (multi-digit) Line is a strict subset of Nested List  

3. **Multi Discrimination:** 
$$\text{Multi-Element List} \subsetneq \text{Multi-Digit List}$$
> Multi-Element List is a strict subset of Multi-Digit List 
> Study by Object

## 2.3 Consecution Principle (interaction)
> - Consecution Principle refers to the effect arisen from the *Upper-Level Line* ==right above== (closest-nest) the typing one 
> - Study, extract, conclude and distill Principle from all case permutations 
> - ---
> - Level: for describing the Line position 
> - **Line**: paragraph line level 
> 	- {parallel, nested} #nest 
> 	- {upper-level, lower-level} (relative&absolute) #vertical 
> 	- {above, inline, beneath} (relative) #vertical 
> - Layer: {higher-grade, lower-grade}, for describing the nesting extent 
> - **Nest**: #horizontal 
> 	- {higher-layer, lower-layer} (relative)
> 	- {primary, child} (absolute)
> 	- {root, parent, child} (property+relative)

### 2.3.1 Initial Shuffle Mechanism 
---
> About the initialization of Initial-Value Line 
> **Rule: Shuffle Last-Digit Element and succeed Other-Digit from Consecutive Parent-Nest Line** 
- [-] $Digit = \{\emptyset, 1, 2, 3, 4\}$ 
	- Initialize Last-Digit Element with *initial value* 
- Special Case: check [[Smart Order List/README#2.3.2.1 Prefix Rollback Mechanism]] 
	- Exceeded Digit 
		- [-] $Digit > 4$ 
		- [-] Exceeding-1-Digit `Numeral.2` 
		- [-] Exceeding-1-Digit `Chinese` 
- By Rule:
	- Ordered Primary-Prefix in Child-Nest only beneath Unordered List 
	- Multi-Digit Prefix must be in nested line 

### 2.3.2 Subsequent Prefix Rewrite Mechanism 
---
> About the Line status in Subsequent-Value Line 
> **Rule:  Increment Last-Digit Element and succeed Other-Digit from Consecutive Upper-Level Line** 
#### 2.3.2.1 Prefix Rollback Mechanism 
> Rule: Rollback prohibited Prefix Line to **Bullet** List and keep the Nest Layer 
- Exceeded-Digit Prefix Rollback 
	- [-] $Digit > 4$ 
	- Exceeding-1-Digit Ordered List Rollback 
		- [x] `Numeral.2` (parenthesized) ^8b482e
		- [x] `Chinese`  ^8b481e
#### 2.3.2.2 Error Correction Mechanism  
---
> Correct *Last-Digit Element* with *Unconsecutive-Value* to *self-consistent Element* with *consecutive value* 
- **Rule**: When Lower-Level Line manually initializes the *Last-Digit Element* with *Unconsecutive-Value*, the Element should be corrected to *self-consistent Element* with *subsequent value* by [[Smart Order List/README#2.3.2 Subsequent Prefix Rewrite Mechanism]], or *self-consistent Element* with *initial value* by [[Smart Order List/README#2.3.1 Initial Shuffle Mechanism]] 
	- "*self-consistent Element*" respects the intention of manual typing, but Prefix's priority is over Plain Content  
	- "value correction" gives more room for fault-tolerance 
- **Flow**: Error triggers Correction 
	1. [-] Last-Digit Element is inconsistent with Upper-Line, and with Uninitial-Value 
		- Initial Shuffle by [[Smart Order List/README#2.3.1 Initial Shuffle Mechanism]] 
	2. [-] Last-Digit Element is consistent with Upper-Line, but with Unsubsequent-Value 
		- Subsequent Prefix Rewrite by [[Smart Order List/README#2.3.2 Subsequent Prefix Rewrite Mechanism]] 
##### Instance 
###### step_0 
1. 1
L.
###### step_1
- Append `Space` in manual initialized line 2 beneath Numeral.1 Line line 1 to stylize it 
###### outcome 
1. 1
A. 
> Line 2 is corrected to *self-consistent Element* `Alphabet.1` with *consecutive value* initial value `A.` 

### 2.3.3 Exit Consecution Mechanism trigger 
---
> About the Line status after Severance, Trigger is the intermediate 
- Inconsistent Parallel Line 
	- Parallel **==Inconsistent== Prefix Header** (List + Mixture)
		- Ordered 
			- [x] Ordered List 
			- [-] Mixture: `Numeral.1`-`Checkbox` 
		- Unordered 
			- [-] Unordered List 
			- [-] Mixture: `Checkbox`-{Ordered List} (special case check Prefix Tail)
	- Parallel **==Inconsistent== Prefix ==Tail==** (List has no Prefix Tail)
		- [-] Mixture: `Checkbox`-{Ordered List} 
	- [-] Parallel **Codeblock** e.g. ` ``` `, `~~~`
		- Cut off Consecution (external) 
		- Ban to respect Raw Codes (internal) 
	- [x] Parallel **Callout** e.g. `> [!NOTE]`
- Inconsistent Unparallel Line
	- [x] Inconsistent Parent-Nest Line (closest-nest is default by Rule) 
- [-] **Heading** e.g. `###` 
- [-] **Dividing Line** e.g. `---` 

### 2.3.4 Maintain Consecution Mechanism trigger 
---
> - About the Line status after Severance, Trigger is the intermediate 
> - Tips : Same Line would succeed 
> - Note: Must distinguish Parameter from pure Classifier, especially in Test's naming. (solution: Title takes with Parameter) 
- **Consistent** Parallell Line
	- Parallel **Consistent Prefix Header** (List + Mixture)
		- Ordered 
			- [-] Ordered List #succeed 
			- [-] Mixture: `Numeral.1`-`Checkbox` #succeed  #half-succeed 
		- Unordered 
			- [-] Unordered List #succeed 
			- [-] Mixture: `Checkbox`-{Ordered List} #succeed  #half-succeed  (special case check Prefix Tail)
	- Parallel **Consistent Prefix ==Tail==** (List has no Prefix Tail)
		- [-] Mixture: `Checkbox`-{Ordered List} #succeed 
- Unparallel Line
	- [-] Consistent Parent-Nest Line #succeed 
	- [-] Lower-Layer Nest Line #non-effect 
- [-] **Blockquote** `>` #non-effect 
- [-] **Plain Line** #non-effect 
- Unordered Prefix doesn't maintain consecution after severance 
- Lower-Level Line (default) #non-effect 

## 2.4 Mix Principle 
$$\text {Mix Principle} = \text {\{mix\_prefix (Ordered List), mix\_list (Mixture)\}} $$
> Unordered List is not internally mixable  
### 2.4.1 Mix_Prefix Permutation (Ordered List)
> Multi-Digit Ordered List (only in Nested-Line) 

| prefix_header: front/rear | Numeral.1 | Alphabet.1 | Alphabet.2 |
| ------------------------- | --------- | ---------- | ---------- |
| **Numeral.1**             | 1         | 1          | 1          |
| **Alphabet.1**            | 1         | 1          | 1          |
| **Alphabet.2**            | 1         | 1          | 1          |
### 2.4.2 Mix_List Permutation (Mixture)
> - **Rule:** Mixture = `Checkbox` × {Ordered List} 
> - {Ordered List} follows [[Smart Order List/README#2.4.1 Mix_Prefix Permutation (Ordered List)]] 

| prefix: header/tail | Checkbox                 | Numeral.1          |
| ------------------- | ------------------------ | ------------------ |
| Checkbox            | -                        | Consecutive Header |
| **Numeral.1**       | Consecutive Tail #manual | -                  |
| **Numeral.2**       | Consecutive Tail         | -                  |
| **Alphabet.1**      | Consecutive Tail         | -                  |
| **Alphabet.2**      | Consecutive Tail         | -                  |
| **Chinese.1**       | Consecutive Tail         | -                  |
- As for the left Mix scenarios, content in `tail` should be treated as Normal Content instead of Prefix. I.e. neither *Prefix Rewrite Mechanism* nor *Mix_List* could effect. 

# 3. Typography 

| Num | Ordered-Element          | Unordered-Element |
| --- | ------------------------ | ----------------- |
| 1   | Numeral.1 #classic       | Bullet            |
| 2   | Numeral.2 #parenthesized | Checkbox          |
| 3   | Alphabet.1 #uppercase    |                   |
| 4   | Alphabet.2 #lowercase    |                   |
| 5   | Chinese.1 #classic       |                   |
## 3.1 Inline Hotkey 
> - Rule: 
> 	- *Ordered-Prefix Hotkey* (Numeral.1) effects **Last-Digit Element**, and Cooperate with [[Smart Order List/README#2.3.1 Initial Shuffle Mechanism]] and [[Smart Order List/README#2.3.2 Subsequent Prefix Rewrite Mechanism]]  
> 	- *Bullet Hotkey* effects the Line's complete Prefix 
> 	- *Checkbox Hotkey* effects Prefix-Tail 

| origin/add    | Numeral.1      | Numeral.2      | Alphabet.1, Alphabet.2 | Chinese.1 | Bullet         | Checkbox      |
| ------------- | -------------- | -------------- | ---------------------- | --------- | -------------- | ------------- |
| **Numeral.1** | **Toggle Off** | **Toggle Off** | Overwrite              | Overwrite | Overwrite      | Overwrite     |
| **Bullet**    | Overwrite      | Overwrite      | Overwrite              | Overwrite | **Toggle Off** | Overwrite     |
| **Checkbox**  | **Append**     | Prepend        | Prepend                | Prepend   | Overwrite      | Switch Status |
## 3.2 Parallel-Nest Ordered-Prefix  
> Last-Digit Element 

| upper/lower    | Numeral.1       | Numeral.2       | Alphabet.1      | Alphabet.2      | Chinese.1       |
| -------------- | --------------- | --------------- | --------------- | --------------- | --------------- |
| **Numeral.1**  | **Consecutive** | Initial-Value   | Initial-Value   | Initial-Value   | Initial-Value   |
| **Numeral.2**  | Initial-Value   | **Consecutive** | Initial-Value   | Initial-Value   | Initial-Value   |
| **Alphabet.1** | Initial-Value   | Initial-Value   | **Consecutive** | Initial-Value   | Initial-Value   |
| **Alphabet.2** | Initial-Value   | Initial-Value   | Initial-Value   | **Consecutive** | Initial-Value   |
| **Chinese.1**  | Initial-Value   | Initial-Value   | Initial-Value   | Initial-Value   | **Consecutive** |
- More to check [[Smart Order List/README#2.4.2 Mix_List Permutation (Mixture)]] 

## 3.3 Child-Nest Ordered-Prefix 
> Last-Digit Element 
> Child-Nest Ordered-Prefix is Multi-Digit Ordered-Prefix 

| nest: parent/child | Numeral.1 | Numeral.2 | Alphabet.1 | Alphabet.2 | Chinese.1 |
| ------------------ | --------- | --------- | ---------- | ---------- | --------- |
| **Numeral.1**      | Succeed   | Overwrite | Succeed    | Succeed    | Overwrite |
| Numeral.2          | -         | -         | -          | -          | -         |
| **Alphabet.1**     | Succeed   | Overwrite | Succeed    | Succeed    | Overwrite |
| **Alphabet.2**     | Succeed   | Overwrite | Succeed    | Succeed    | Overwrite |
| Chinese.1          | -         | -         | -          | -          | -         |

# 4. Test Case 
> Should conduct all the Analogical Reasoning tests 
## 1. Consecution Principle > Initial Shuffle Mechanism 
### Case_1-1: $Digit = \{\emptyset, 1, 2, 3, 4\}$ #success 
---
#### Instance $Digit = \{3\}$
##### step_0
1. a
	1.1 b
	1.2 c
##### step_1 
- Append `Tab` in line 3 to stylize 
> Line 3 is expected to initialize itself in new nest with *3 digits* 
##### outcome 
1. a
	1.1 b
		1.1.1 c
> The *Last-Digit Element* of line 3 (the third-digit) successfully initialized with *initia-value* `1` 
### Case_1-2: Exceeded Digit > $Digit > 4$ #success 
---
#### Instance (Rollback)
##### step_0 
1. a
	1.1 b
		1.1.1 c
			1.1.1.1 d
			1.1.1.2 e
##### step_1 
- Append `Tab` in line 5 to stylize 
> Line 5 is expected to initialize itself in new nest with *5 digits* 
##### outcome 
1. a
	1.1 b
		1.1.1 c
			1.1.1.1 d
			- e
		- f
	- g
- h
> - Line 5 successfully rollbacked to Bullet List 
> - others: Bullet List in line 5-8 successfully stylized as native Bullet dot style 
### Case_1-3: Exceeded Digit > Exceeding-1-Digit `Numeral.2` #success 
---
#### Instance (Rollback)
##### step_0
(1) 1
(2) 2
(3) 3
##### step_1 
- Append `Tab` in line 3 to stylize 
> Line 3 is expected to initialize itself in new nest with *2 digits* 
##### outcome 
(1) 1
(2) 2
	- 3
> - Line 3 successfully rollbacked to Bullet List 
> - Bullet List in line 3 successfully indented and stylized as native Bullet dot 
### Case_1-4: Exceeded Digit > Exceeding-1-Digit `Chinese` #success 
---
#### Instance (Rollback)
##### step_0
一、 1
二、 2
三、 3
##### step_1
- Append `Tab` in line 3 to stylize 
> Line 3 is expected to initialize itself in new nest with *2 digits* 
##### outcome 
一、 1
二、 2
	- 3
> - Line 3 successfully rollbacked to Bullet List 
> - Bullet List in line 3 successfully indented and stylized as native Bullet dot 

## 2. Consecution Principle >  Subsequent Prefix Rewrite Mechanism 
### Case_2-1: Prefix Rollback Mechanism #success 
> - Review case: 
> 	- [[Smart Order List/README#Case_1-2 Exceeded Digit > $Digit > 4$ success]] 
> 	- [[Smart Order List/README#Case_1-3 Exceeded Digit > Exceeding-1-Digit `Numeral.2` success]] 
> 	- [[Smart Order List/README#Case_1-4 Exceeded Digit > Exceeding-1-Digit `Chinese` success]] 
### Case_2-2: Error Correction Mechanism > Last-Digit Element is inconsistent with Upper-Line, and with Uninitial-Value #success 
---
#### Instance 
##### step_0
a. 1
5.
##### step_1
- Append `Space` in line 5 to stylize 
##### outcome 
a. 1
1. 
> Line 2 is successfully corrected to *self-consistent Element* with *consecutive value*  by Initial Shuffle 
### Case_2-3: Error Correction Mechanism > Last-Digit Element is consistent with Upper-Line, but with Unsubsequent-Value #success 
---
#### Instance 
##### step_0
1. 1
5.
##### step_11
- Append `Space` in line 2 to stylize 
##### outcome 
1. 1
2. 
> Line 2 is successfully corrected to *self-consistent Element* with *consecutive value*  by Subsequent Prefix Rewrite 

## 3. Consecution Principle > Exit Consecution Mechanism 
### Case_3-1: Parallel Inconsistent Prefix Header > Ordered List #success 
---
#### Instance_1
##### step_0
1. 1
a. 2
1.
##### step_1
- Append `Space` in line 3 to stylize and type 
##### outcome 
1. 1
a. 2
2. 
> Line 2 is Alphabet.2 in inconsistent prefix header from line 1 
> Line 3 successfully exited consecution from line 1 (initial shuffle) 
### Case_3-2: Parallel Inconsistent Prefix Header > Mixture: `Numeral.1`-`Checkbox` #success 
---
#### Instance 
##### step_0
a. 1
1. [ ] 2
a.
##### step_1
- Append `Space` in line 3
##### outcome 
a. 1
1. [ ] 2
a. 
> Line 2 is Numeral.1 in prefix header inconsistent from Alphabet.2 in line 1 
> Line 3 successfully exited consecution from line 1 (initial shuffle) 
### Case_3-3: Parallel Inconsistent Prefix Header > Unordered List #success 
---
#### Instance 
1. 1
- 2
1. 3
> Line 3 successfully exited consecution from Numeral.1 in line 1 
### Case_3-4: Parallel Inconsistent Prefix Header > Mixture: `Checkbox`-{Ordered List} #success 
---
#### Instance 
a. 1
- [ ] 1. 2
a. 3.
> Line 3 below inconsistent Prefix Header Checkbox in line 2 Mixture, successfully exited consecution from Alphabet.2 in line 1
### Case_3-5: Parallel Inconsistent Prefix Tail > Mixture: `Checkbox`-{Ordered List} #success 
---
#### Instance_1 
- [ ] 1. 1
- [ ] a. 2
- [ ] 1. 3
> Line 3 below Prefix Tail Alphabet.2 in line 2 Mixture, successfully exited consecution from Prefix Tail Numeral.1 in line 1 
### Case_3-6: Parallel Codeblock #success 
---
#### Instance 
a. 1
```
2
```
a. 3
> Last line beneath parallel Codeblock successfully exited consecution from Alphabet.2 in line 1 
### Case_3-7: Parallel Callout  #success 
---
#### Instance 
##### step_0
1. 1
> [!NOTE] Title
> 2
1.
##### step_1
- Append `Space` in last line to stylize 
##### outcome 
1. 1
> [!NOTE] Title
> 2
2. 3
> Last line beneath parallel Callout successfully exited consecution from Numeral.1 in line 1
### Case_3-8: Inconsistent Parent-Nest Line #success 
---
#### Instance 
##### step_0
1. 1
	-  2
		- 3
##### step_1
- Append `Numeral Hotkey` in line 3
##### outcome 
1. 1
	-  2
		1. 3
> Line 3's Inconsistent Parent-Nest Line is line 2
> Line 3 successfully exited consecution from Numeral.1 in line 1
### Case_3-9: Heading #success 
---
#### Instance 
1. 1
##### 2
1. 3
> Line 3 beneath Heading successfully exited consecution from Numeral.1 
### Case_3-10: Dividing Line #success 
---
#### Instance 
1. 1
---
1. 2

## 4. Consecution Principle > Maintain Consecution Mechanism 
### Case_4-1: Parallel Consistent Prefix Header > Ordered List #succeed #success 
---
#### Instance 
a. 1
b. 2
c. 3
> Line 3 successfully maintained consecution from line 1 and succeeded line 2 in Alphabet.2 
### Case_4-2: Parallel Consistent Prefix Header > Mixture: `Numeral.1`-`Checkbox` #succeed #half-succeed #success 
---
#### Instance #half-succeed 
1. 1
2. [ ] 2
3. 3
> Line 3 beneath Parallel Consistent Prefix Header Numeral.1 in line 2, successfully maintained consecution from line 1 and half-succeeded line 2 in Numeral.1 
### Case_4-3: Parallel Consistent Prefix Header > Unordered List #succeed #success 
---
#### Instance 
- 1
- 2
- 3
> Line 3 successfullly maintained from line 1 and succeeded from line 2 in Bullet 
### Case_4-4: Parallel Consistent Prefix Header > Mixture: `Checkbox`-{Ordered List} #succeed #half-succeed #success 
---
#### Instance_1 #half-succeed 
- [ ] 1
- [ ] a. 2
- [ ]  3
> Line 3 beneath Parallel Consistent Prefix Header Checkbox in line 2 Mixture, successfully maintained consecution from Checkbox in line 1 and half-succeeded line 2 in Checkbox 
#### Instance_2 #half-succeed 
- [ ] a. 1
- [ ] 1. 2
- [ ] a. 3
> Line 3 beneath Parallel Consistent Prefix Header Checkbox in line 2, successfully maintained from Checkbox in line 1 and half-succeeded line 2 
### Case_4-5: Parallel Consistent Prefix Tail > Mixture: `Checkbox`-{Ordered List} #succeed #success 
---
#### Instance_1 
- [ ] 1. 1
- [ ] 2. 2
- [ ] 3. 3
> Line 3 beneath line 2 successfully maintained consecution from Numeral.1 in line 1 and succeeded line 2 in Prefix Tail Numeral.1 
> Note: Prefix Tail is exclusive to Mixture, so Parallel Consistent Prefix Tail means the same Mixture in both header and tail i.e. last line should succeed the upper line 
#### Instance_2 #dialectic 
1. 1
- [ ] 1. 2
1. 3
> Attention: List has no Prefix Tail. Instance_2 is dialectic instance to relieve potential concern of Parallel Consistent Prefix Tail Case 
> Line 3 successfully neither maintained consecution from Numeral.1 in line 1 nor half-succeeded line 2, although it **seems** to share the same Prefix Tail Numeral.1 with line 2 Mixture which is illegal 
### Case_4-6: Unparallel Line >  Consistent Parent-Nest Line #succeed #success 
---
#### Instance 
1. 1
	1.1 2
		1.1.1 3
> Line 3 successfully maintained consecution from Numeral.1 in line 1 and succeeded from line 2
### Case_4-7: Unparallel Line >  Lower-Layer Nest Line #non-effect #success 
---
#### Instance 
1. 1
	1.a 2
2. 3
> Line 3 beneath Lower-Layer Nest Line line 2, successfully maintained from Numeral.1 in line 1 and line 2 has non-effect 
### Case_4-8: Blockquote `>` #non-effect  #success 
---
#### Instance 
1. 1
> 2
2. 3
> Line 3 is successfully uneffected by Blockquote in line 2 
### Case_4-9: Plain Line (non-List) #non-effect  #success 
---
#### Instance 
1. 1
2
2. 3
> Line 3 is successfully uneffected from Plain Line in line 2 