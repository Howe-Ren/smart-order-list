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
			- [-] Parenthesized, <span style="color:grey">(0)</span>-(9)
		1. Alphabet 
			- [-] Uppercase, A-Z #mixable 
			- [-] Lowercase, a-z #mixable 
		1. Chinese numerals 
			- [-] Classic, 一、... 九、
		1. Roman Numerals 
			- [ ] Classic, I-II...
				- Initial "I."  unrelates consecutive "H. ", inline: 
					- `Space` > **Alphabet** 
						- `Enter` > **Roman** (Roman Numeral font style)
							- `Enter` > step forward  (upgrade list level) 
				- Initial "I." beneath consecutive "H. ", next-line: 
					- Single `Enter` > **Alphabet** 
					- Double `Enter` > **Roman**
					- Triple `Enter` > step forward  (upgrade list level) 
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
			- [ ] Ban to respect Raw Codes (internal) 
		- [-] **Headling "###"** 
		- [-] **Dividing Line "---"** 
		- Unordered List 
			- [-] **Bullet list**
			- [-] **Checkbox list** 
	- **==Maintain== Mechanism** 
		- [-] **Plain Line** (nonList)
---
# List Type 

| Num | Ordered  | Unordered |
| --- | -------- | --------- |
| 1   | Numeral  | Bullet    |
| 2   | Alphabet | Checkbox  |
| 3   | Chinese  |           |
| 4   | Roman    |           |
## debug for mixture of Checkbox (hotkey) and Ordered lists 
| front/behind    | Checkbox                    | Numeral | Alphabet        | Chinese         | Roman (invalid) |
| --------------- | --------------------------- | ------- | --------------- | --------------- | --------------- |
| Numeral         | 0 (grey-ground unavailable) | -       | -               | -               | -               |
| Alphabet        | 0 (auto switch)             | -       | -               | -               | -               |
| Chinese         | 0 (auto switch)             | -       | -               | -               | -               |
| Roman (invalid) | 0                           | -       | -               | -               | -               |
| Checkbox        | -                           | 1       | 0 (auto switch) | 0 (auto switch) | 0               |
