## Preview
![README preview](assets/2026-0317_0251.png)


# 1. Insight 
---
1. Parallel Principle: The **parallel** lists align ==internal consecution== with each other in **default**.
2. Proactive behavior 
	2.1 double `Enter` #style 
	2.2 Manual initial #style 
	2.3 Insert `\` before prefix's `.` #silence 
3. Passive behavior 
	3.1 single `Enter` 
	3.2 `Space` 
	3.3 `Tab` 

# 2. Feature 
## 2.1 Styles 
---
- Grey-background prefix 
- Supporting
	1. Numerals (prior)
		- [-] Classic (Numeral.1), <span style="color:grey">0</span>-9 #mixable 
			1. `1. ` 
			2. `1.1 ` 
			3. `1.1.1 ` 
			4. `1.1.1.1 ` 
			- Note: `0` in the first digit (rightest) is prohibited e.g. `0. `, `1.0 ` etc 
		- [-] Parenthesized (Numeral.2), `([Num]) ` 
			1. `(1) ` 
			- Note: Single digit only, e.g. `(1).(1) ` is prohibited 
	2. Alphabet 
		- [-] Uppercase (Alphabet.1), A-Z #mixable 
			- `A. ` ~ `A.A.A.A `
		- [-] Lowercase (Alphabet.2), a-z #mixable 
			- `a. ` ~ `a.a.a.a ` 
	3. Chinese numerals 
		- [-] Classic, 一、... 九、
			1. `一、 ` 
			- Note: 
				- Single digit only, e.g. `一、.一、 ` is prohibited 
	4. ~~Roman Numerals~~ #suspend 
		- Note: treat as normal texts currently 
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
- Constraint  
	1. One **Alphabet** per **digit** e.g. `a.a ` 
	2. Ordered lists should not end prefix with `.` unless there's only one digit. 
	3. Prefix max digits: 4 e.g. `1.1.1.1.1 ` is prohibited 
	4. ==Prefix mixture== only supports **Numeral** and **Alphabet** e.g. `a.1 ` 
	5. Manual shuffle is necessary when **Ordered lists** in ==order chaos== via either hotkey or prefix edition to any lists 
	6. others: Order in Heading could be realized by manipulating the Outline 
## 2.2 Consecution Principle (consecutive list)
---
1. **==Shuffel== Mechanism** 
	- Auto Shuffle prefixes, cooperating with **Prefix Rewrite Mechanism** 
	- Consecutive Parallel style 
	- Consecutive nested prefix 
2. **==Prefix Rewrite== Mechanism** 
	- Cooperate with **Shuffle Mechanism** after Rewrite 
	- Only ==single== list prefix lives, unless with **Checkbox** 
		- Usually triggered by list ==hotkey== effecting the existing prefix instantly.
3. **==Exit== Mechanism** triggers 
	- [ ] Other Parallel **Ordered** lists 
	- [-] Parallel **Codeblock** e.g. ` ``` `, `~~~`
		- Cut off Consecution (external) 
		- Ban to respect Raw Codes (internal) 
	- [-] **Heading** e.g. `###` 
	- [-] **Dividing Line** e.g. `---` 
	- Unordered List 
		- [-] **Bullet list**
		- [-] **Checkbox list**, Note: except the **Ordered lists** within **Checkbox** list (mixture) 
4. **==Maintain== Mechanism** 
	- [-] **Plain Line** (nonList)

---
# 3. Supported List Type 

| Num | Ordered                  | Unordered |
| --- | ------------------------ | --------- |
| 1   | Numeral.1 #classic       | Bullet    |
| 2   | Numeral.2 #parenthesized | Checkbox  |
| 3   | Alphabet.1 #uppercase    |           |
| 4   | Alphabet.2 #lowercase    |           |
| 5   | Chinese #classic         |           |

## 3.1 Shuffle Mechanism and Prefix Rewrite Mechanism 

| old/new               | Numeral.1  | Numeral.2      | Alphabet  | Chinese   | Bullet     | Checkbox      |
| --------------------- | ---------- | -------------- | --------- | --------- | ---------- | ------------- |
| **Numeral** (hotkey)  | Toggle Off | **Toggle Off** | Overwrite | Overwrite | Overwrite  | Overwrite     |
| **Bullet** (hotkey)   | Overwrite  | Overwrite      | Overwrite | Overwrite | Toggle Off | Overwrite     |
| **Checkbox** (hotkey) | **Append** | Prepend        | Prepend   | Prepend   | Overwrite  | Switch Status |
> Proactive **Numeral** has high priority. 
> List hotkey's intent is absolute: to change text into specific list.

### 3.1.1 Shuffle Mechanism in multiple Ordered lists 

| up/below       | Numeral.1   | Numeral.2   | Alphabet.1  | Alphabet.2  | Chinese.1   |
| -------------- | ----------- | ----------- | ----------- | ----------- | ----------- |
| **Numeral.1**  | Consecutive |             |             |             |             |
| **Numeral.2**  |             | Consecutive |             |             |             |
| **Alphabet.1** |             |             | Consecutive |             |             |
| **Alphabet.2** |             |             |             | Consecutive |             |
| **Chinese.1**  |             |             |             |             | Consecutive |


## 3.2 Supported mixture of Checkbox and Ordered lists 
| front/behind | Checkbox             | Numeral      | Alphabet | Chinese |
| ------------ | -------------------- | ------------ | -------- | ------- |
| **Checkbox** | -                    | instance_2.1 | -        | -       |
| **Numeral**  | instance_1.1 #manual | -            | -        | -       |
| **Alphabet** | instance_1.2         | -            | -        | -       |
| **Chinese**  | instance_1.3         | -            | -        | -       |
> Consecution: both **Checkbox** and **Ordered list** are maintained 
### 1. {Checkbox}` `{Ordered list}
- Checkbox Exit method: 
	1. Cursor #safe
		1.1 Key combination: double `Home` > `Ctrl` + `Shift` + triple `→` > `Delete` 
		1.2 Mouse: manually locat and delete the **source code** of **Checkbox** 
	2. Hotkey: 
		2.1 **Numeral list** hotkey (`Toggle numbered list` in Obsidian)
			- #safe Overwrite **Checkbox** with **Numeral** 
		2.2 **Bullet list** hotkey (`Toggle bullet list` in Obsidian)
			- #risk Overwrite ==whole== list style with **Bullet** 
#### 1.1 {Checkbox}` `{Numeral}
- [ ] 1. test1
> Only from manual Numeral (not hotkey)
#### 1.2 {Checkbox}` `{Alphabet}
- [ ] a. test1
#### 1.3 {Checkbox}` `{Chinese}
- [ ] 一、 test1

- To Exit Checkbox:
	1. Cursor #safe 
		1.1 Key combination: `Home` > `Ctrl` + `Shift` + double `←` > `Delete` 
		1.2 Mouse: manually locat and delete **source code** of **Checkbox** 
	2. Hotkey: 
		2.1 **Numeral list** hotkey (`Toggle numbered list` in Obsidian)
			- #risk Clear ==whole== list style 
		2.2 **Bullet list** hotkey (`Toggle bullet list` in Obsidian)
			- #risk Overwrite ==whole== list style with **Bullet** 
#### 2.1 {Numeral}` `{Checkbox}
1. [ ] test1
> - To keep Checkbox only: `Numeral hotkey`/`Bullet hotkey` + `Checkbox hotkey` 
> - To bring Checkbox front: `Numeral hotkey`/`Bullet hotkey` + `Checkbox hotkey` > edit Numeral right behind Checkbox 
> - The consecution among all parallel mixture of Numeral and Checkbox is interconnected

# 4. known issues 
#### issue_1 Bullet list strips dot behind 4 spaces 
---
1. 1
	1.1 2
		1.1.1 3
			1.1.1.1 4
			- 5
		- 6
	- 7
- 8
> Like line "5" and "6" above.
##### unsolved reason 
- Markdown's strictest rule: **Any text indented by 4 spaces (1 Tab) that isn't attached to a native list is an Indented Code Block.**
- Because Obsidian doesn't recognize 1.1.1. as a list marker, the chain is broken. 
- Kept for not modifying forcedly 

# 5. issues to resolve 
#### 2026-03-17_03:03
- synchronize effect of **living editing** to **reading** mode 

#### issue_1: Shuffle Mechanism of multiple Ordered lists 
##### issue_1-1: {Ordered-list.1}-{(other 4 Ordered lists)}
---
###### step_0
1. 1
(2)
###### step_1
- append `Space` in line 2 to make it `Numeral.2` 
###### outcome 
1. 1
2. 
> - Instance is {Numeral.1}-{Numeral.2}
> - Line 2 changed to consecutive Numeral.1
> - Others: Line 2 won't activate Numeral.2 until line 2 is initialized with `(0) ` or `(1) ` 
###### more
- This issue exists among {Numeral.1}-{(other 4 Ordered lists)}
- Line 2 is always changed to Numeral.1 unless initialize line 2 with initial order item in other 4 Ordered lists 
##### furthermore
- The issue extends to {Ordered-list.1}-{(other 4 Ordered lists)}
- Line 2 is always changed to {Ordered-list.1}.1 unless initialize line 2 with initial order item in other 4 Ordered lists 
- Do you feel it as an Error Correction Mechanism or an essential issue?
	- Is it necessary to fix it?
