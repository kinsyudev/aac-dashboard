# UI conventions

AAC Dashboard uses the Craft Tool's restrained hierarchy across every Player-facing Tool.

- Use `PageShell` for responsive page padding and an intentional `normal`, `wide`, `narrow`, or `landing` width. A normal page has exactly one `PageHeading`.
- Compose major regions with `PageSection`: a labelled level-two section, an optional description and actions, and a quiet top separator. Do not wrap structural sections in cards.
- Reserve cards for independent destinations, Saved Plans, selectable objects, compact metrics, and table or chart frames whose containment communicates meaning. Never recursively nest Recipe cards.
- Use `ResponsiveRow` for Item and Material collections. Static rows use separators; only interactive rows receive hover treatment. Actions wrap beneath details on narrow screens.
- Use `Metric` and `MetricGrid` for summaries. Values use tabular numbers and the shared semantic tones: success, warning, destructive, muted, and incomplete.
- Use `InlineState` for loading, empty, unavailable, incomplete, warning, and error states. Loading and incomplete results announce politely; errors use an alert.
- Use the shared Field, Input, Select, Checkbox, Button, Tooltip, Table, Progress, Badge, and Accordion modules. Controls need contextual accessible names and visible focus treatment.
- Recipe planning shows one focused Recipe at a time with a visible production path, explicit Recipe Choices, Buy/Craft Acquisition Modes, and Inspect actions for crafted Materials.
- Missing Price is unknown, never zero, free, `N/A`, or blank. Identify Price Override and Market Data sources. Suppress dependent totals when a result is incomplete.
- Display ordinary economic summaries as compact Gold. Keep exact Gold, Silver, and Copper where denomination progress is part of the Player's task. Labor remains separate and efficiency is Silver / Labor.
- Use Profit Before Fees when sale fees are not modeled. Use Profit only for already-net Revenue.
- Dense comparisons remain tables inside a labelled horizontal scroll container when necessary. Verify representative layouts at 390, 768, and 1440 CSS pixels in light and dark themes.
