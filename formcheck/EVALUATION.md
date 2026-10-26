# Form check evaluation (synthetic data)

**All figures below are measured on synthetic data** produced by `training/generate.py` (seeded). They show that the
pipeline works and how the rules and the model complement each other; they say nothing yet about real AICTE forms.
Real-world performance must be measured on labelled historical applications before any claim is made.

Model: Isolation Forest (200 trees, 256 samples per tree, random_state 7), version `application_form_v1`.
Threshold: 97th percentile of training anomaly scores = 0.5794.
Test sets: 1000 normal forms, 1000 faulty forms (200 per fault type).

## Overall

| Mode | Precision | Recall | False-alarm rate |
|---|---:|---:|---:|
| Rules only | 1.000 | 0.859 | 0.000 |
| Model only | 0.842 | 0.117 | 0.022 |
| Hybrid (rules or model) | 0.975 | 0.863 | 0.022 |

## Recall per fault type

| Fault | Rules only | Model only | Hybrid |
|---|---:|---:|---:|
| Unit error on land area (x10, /10, x10.76) | 0.295 | 0.070 | 0.315 |
| Built-up larger than plot | 1.000 | 0.280 | 1.000 |
| Faculty shortage | 1.000 | 0.090 | 1.000 |
| Expired lease | 1.000 | 0.060 | 1.000 |
| Bulk fill with missing documents | 1.000 | 0.085 | 1.000 |

## Reading the numbers

* Rules catch the faults they were written for with no false alarms on normal forms; they cannot see a unit error that keeps
  the built-up area below the plot (for example land multiplied by 10).
* The model flags unusual combinations, which is where unit errors show up, at the cost of a small false-alarm rate set by the
  97th-percentile threshold. Model warnings are MEDIUM severity and only ask for a justification.
* The check is advisory: it never blocks filing and never affects routing, deadlines, assignment or Action Center order.
