### Insight 
---
1. Parallel Principle 
	1.1 The **parallel** lists align ==properties== with each other in **default** 
2. Proactive behavior 
	2.1 `Enter`: double #style 
	2.2 Manual initial #style 
	2.3 Insert `\` before `.` #silence 
3. Passive behavior 
	3.1 `Enter`: single 
	3.2 `Space` 
	3.3 `Tab` 
	3.4 Single `Enter` 

### Feature 
---
- Styles 
	- Grey-background prefix 
	- Supporting
		1. Numerals (prior)
			- [-] Normal, <span style="color:grey">0</span>-9 #mixable 
				- Numeral without `.` doesn't trigger List  
			- [-] Parenthesized, <span style="color:grey">(0)</span>-(9)
		2. Alphabet 
			- [-] Uppercase, A-Z #mixable 
			- [-] Lowercase, a-z #mixable 
		3. Chinese numerals 
			- [-] Classic, 一、... 九、
		4. ~~Roman Numerals~~ #suspend 
			- note: treat as normal texts 
			- Suspend: The complex interaction of triggering Roman numerals via specific `Space + Enter` sequences is extremely difficult to reliably capture within CodeMirror's transaction-based state engine, as the auto-formatting engine and keystroke events constantly fight each other. Taking your advice, **we will suspend the complex Roman toggle mechanics** for now to ensure the core features remain rock-solid. Basic Roman consecutive counting will still work if typed out (e.g., `III.`), but the auto-magic toggle is removed.
			- [ ] Classic, I-II...
				- Initial "I."  unrelates consecutive "H. ", inline: 
					- [-] `Space` > **Alphabet** (shuffle to "A/a")
					- [ ] `Space` + `Enter` > **Roman** 
						- Only if `Enter` right behind `Space`, even if inline content exists. Otherwise, `Enter` trigger Alphabet consecution e.g. `Enter` behind inline content. 
						- #issue `Enter` turned Alphabet ("A") to Roman, but suddenly auto-back to Alphabet ("A") 
					- [ ] `Space` + double `Enter` > step forward  (upgrade inline list level) 
				- Initial "I." beneath consecutive "H. ", next-line: 
					- Single `Enter` > **Alphabet** 
					- Double `Enter` > **Roman**
					- Triple `Enter` > step forward  (upgrade list level) 
				- Conclusion
					- [ ] Alphabet first, Roman second activated only by `Enter` right behind prefix's `Space` 
	- Limitation 
		- [-] One Alphabet per digit e.g. "a.a "
		- [-] Prefix max digits: 4
			- to Forbid "1.2.3.4.5 " etc from stylizing 
		- [-] Mixture supports **Numeral** and **Alphabet** only e.g. "a.1 "
- Consecutive List 
	- [-] Auto refresh sequence
		- Shuffle both **initial** and **manual** prefixes 
			- [ ] Cooperate with **Prefix Rewrite Mechanism** 
		- Parallel style 
		- Nested-parental prefix 
	- **==Prefix Rewrite== Mechanism** 
		- Once if the inline addition is identified by supported styles as the prefix, there should be **single list style** existing 
			- [-] It's usually triggered by **Unorder list** and **Numeral list** ==hotkeys==, which effect the existing prefix instantly.
			- [-] Meanwhile, if inserting `Space` ahead of the existing prefix before the addition, the former one should be **saved** as ==normal text== without grey-background  which wouldn't trigger consecutive list neither anymore. 
		- Exception 
			- **Checkbox list** could live with all inline **Ordered lists** (not the **bullet list**) 
				- [ ] #issue check [[README#debug for mixture of Checkbox and Ordered lists]]
	- **==Exit== Mechanism** triggers 
		- Parallel **Codeblock "\`\`\`", "\~\~\~"**
			- [-] Cut off Consecution (external) 
			- [-] Ban to respect Raw Codes (internal) 
				- Cancel Numeral indention  e.g. the new next line after "1. "
		- [-] **Headling "###"** 
		- [-] **Dividing Line "---"** 
		- Unordered List 
			- [-] **Bullet list**
			- [-] **Checkbox list**, Note: except the Ordered list within Checkbox list (mixture) 
	- **==Maintain== Mechanism** 
		- [-] **Plain Line** (nonList)
---
# List Type 

| Num | Ordered         | Unordered |
| --- | --------------- | --------- |
| 1   | Numeral         | Bullet    |
| 2   | Alphabet        | Checkbox  |
| 3   | Chinese         |           |

## debug for mixture of Checkbox (hotkey) and Ordered lists 
| front/behind | Checkbox             | Numeral           | Alphabet          | Chinese           |
| ------------ | -------------------- | ----------------- | ----------------- | ----------------- |
| Numeral      | #resolved instance_1 | -                 | -                 | -                 |
| Alphabet     | #resolved instance_2 | -                 | -                 | -                 |
| Chinese      | #resolved instance_3 | -                 | -                 | -                 |
| Checkbox     | -                    | #error instance_4 | #error instance_5 | #error instance_6 |
### instance_1
---
#### step_0
- [ ] 1. test1
- [ ] 2. test2
#### step_1
- append `Enter`
#### outcome 
- [ ] 1. test
- [ ] 
#### issue
1. Numeral prefix "1." grey-ground unavailable
2. next line's prefix lost

### instance_2
---
#### step_0
- [ ] a. test1
- [ ] b. test2
#### step_1
- append `Space`
#### outcome
- [ ] 1. 
#### issue 
- Alphabet turned Numeral

### instance_3
---
#### step_0
- [ ] 一、 test1
- [ ] 二、 test2
#### step_1
- append `Space`
#### outcome
- [ ] 1. 
#### issue 
- Chinese turned Numeral 

### instance_4
---
#### step_0
1. [ ] test
#### step_1
- append `Enter`
#### outcome
1. [ ] test
- [ ] 2. 
#### issue
- in next line, the prefix list style switched

### instance_5
---
#### step_0
a. 
#### step_1
- append Checkbox 
#### outcome 
- [ ] a. 
#### issue
- the prefix list style switched

### instance_6
---
#### step_0
一、 
#### step_1
- append Checkbox 
#### outcome
- [ ] 一、 
#### issue
- the prefix list style switched

