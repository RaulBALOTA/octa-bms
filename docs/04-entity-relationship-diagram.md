# 04 — Entity Relationship Diagram

Rendered as Mermaid (GitHub/VS Code preview). Split by domain for readability;
cardinality shown at the "many" end. Full attribute detail lives in `schema.prisma`.

## Core: Organization & Identity

```mermaid
erDiagram
    COMPANY ||--o{ OFFICE : has
    COMPANY ||--o{ DEPARTMENT : has
    COMPANY ||--o{ BUSINESS_UNIT : has
    COMPANY ||--o{ COST_CENTER : has
    COMPANY ||--o{ PROFIT_CENTER : has
    COMPANY ||--o{ COMPANY_MEMBERSHIP : grants
    USER ||--o{ COMPANY_MEMBERSHIP : holds
    USER ||--o{ USER_ROLE : assigned
    ROLE ||--o{ USER_ROLE : "granted via"
    ROLE ||--o{ ROLE_PERMISSION : includes
    PERMISSION ||--o{ ROLE_PERMISSION : "part of"
    BUSINESS_UNIT ||--o{ DEPARTMENT : groups
    DEPARTMENT ||--o{ DEPARTMENT : "parent of"
    COST_CENTER ||--o{ DEPARTMENT : "charges to"
    USER ||--o| EMPLOYEE : "is linked to"
```

## HR

```mermaid
erDiagram
    COMPANY ||--o{ EMPLOYEE : employs
    OFFICE ||--o{ EMPLOYEE : hosts
    DEPARTMENT ||--o{ EMPLOYEE : contains
    POSITION ||--o{ EMPLOYEE : holds
    EMPLOYEE ||--o{ EMPLOYEE : manages
    EMPLOYEE ||--o{ EMPLOYMENT_CONTRACT : has
    EMPLOYEE ||--o{ EMPLOYEE_SKILL : has
    SKILL ||--o{ EMPLOYEE_SKILL : "rated in"
    EMPLOYEE ||--o{ EMPLOYEE_CERTIFICATE : holds
    EMPLOYEE ||--o{ LEAVE_REQUEST : submits
    EMPLOYEE ||--o{ LEAVE_BALANCE : "has yearly"
    EMPLOYEE ||--o{ BUSINESS_TRIP : takes
    EMPLOYEE ||--o{ PERFORMANCE_REVIEW : receives
    EMPLOYEE ||--o| CV_PROFILE : maintains
    TRAINING ||--o{ TRAINING_PARTICIPATION : has
    EMPLOYEE ||--o{ TRAINING_PARTICIPATION : attends
    JOB_OPENING ||--o{ APPLICANT : receives
    APPLICANT ||--o{ INTERVIEW : "invited to"
```

## CRM → Sales → Contracts → Finance (the revenue chain)

```mermaid
erDiagram
    COMPANY ||--o{ BUSINESS_PARTNER : maintains
    BUSINESS_PARTNER ||--o{ CONTACT : has
    BUSINESS_PARTNER ||--o{ CRM_ACTIVITY : "logged against"
    CONTACT ||--o{ CRM_ACTIVITY : "involved in"
    BUSINESS_PARTNER ||--o{ OPPORTUNITY : generates
    OPPORTUNITY ||--o| GO_NO_GO_EVALUATION : "evaluated by"
    OPPORTUNITY ||--o{ OPPORTUNITY_COMPETITOR : faces
    COMPETITOR ||--o{ OPPORTUNITY_COMPETITOR : "competes in"
    OPPORTUNITY ||--o{ PROPOSAL : "answered with"
    PROPOSAL ||--o{ PROPOSAL_VERSION : versioned
    PROPOSAL ||--o{ FEE_CALCULATION_LINE : "priced by"
    BUSINESS_PARTNER ||--o{ CONTRACT : "party to"
    CONTRACT_TYPE ||--o{ CONTRACT : classifies
    CONTRACT ||--o{ CONTRACT_VERSION : versioned
    CONTRACT ||--o{ CONTRACT_OBLIGATION : imposes
    CONTRACT ||--o{ PAYMENT_MILESTONE : schedules
    CONTRACT ||--o{ VARIATION_ORDER : amended_by
    CONTRACT ||--o{ CLAIM : "disputed via"
    CONTRACT ||--o{ BANK_GUARANTEE : "secured by"
    CONTRACT ||--o{ CONTRACT : "framework for"
    BUSINESS_PARTNER ||--o{ INVOICE : "billed/bills"
    INVOICE ||--o{ INVOICE_LINE : contains
    TAX_CODE ||--o{ INVOICE_LINE : taxes
    COST_CENTER ||--o{ INVOICE_LINE : "allocated to"
    BANK_ACCOUNT ||--o{ PAYMENT : "moves via"
    PAYMENT ||--o{ PAYMENT_ALLOCATION : "settles"
    INVOICE ||--o{ PAYMENT_ALLOCATION : "settled by"
    BUDGET ||--o{ BUDGET_LINE : contains
    COST_CENTER ||--o{ BUDGET_LINE : "planned for"
```

## Procurement & Assets

```mermaid
erDiagram
    PURCHASE_REQUEST ||--o{ PURCHASE_REQUEST_ITEM : lists
    PURCHASE_REQUEST ||--o{ PURCHASE_ORDER : "fulfilled by"
    BUSINESS_PARTNER ||--o{ PURCHASE_ORDER : supplies
    PURCHASE_ORDER ||--o{ PURCHASE_ORDER_ITEM : lists
    PURCHASE_ORDER ||--o{ GOODS_RECEIPT : "received via"
    BUSINESS_PARTNER ||--o{ SUPPLIER_EVALUATION : "rated by"
    ASSET_CATEGORY ||--o{ ASSET : classifies
    ASSET ||--o{ ASSET_ASSIGNMENT : "handed over via"
    EMPLOYEE ||--o{ ASSET_ASSIGNMENT : receives
    ASSET ||--o{ MAINTENANCE_RECORD : "serviced via"
```

## Documents, Workflow, Cross-cutting

```mermaid
erDiagram
    FOLDER ||--o{ FOLDER : contains
    FOLDER ||--o{ DOCUMENT : stores
    DOCUMENT_TYPE ||--o{ DOCUMENT : classifies
    DOCUMENT ||--o{ DOCUMENT_VERSION : versioned
    KNOWLEDGE_CATEGORY ||--o{ KNOWLEDGE_ARTICLE : groups
    KNOWLEDGE_ARTICLE ||--o{ ARTICLE_VERSION : versioned
    WORKFLOW_DEFINITION ||--o{ WORKFLOW_INSTANCE : instantiates
    WORKFLOW_INSTANCE ||--o{ APPROVAL_TASK : creates
    APPROVAL_TASK ||--o{ APPROVAL_ACTION : "acted on by"
    USER ||--o{ APPROVAL_ACTION : performs
    USER ||--o{ NOTIFICATION : receives
    USER ||--o{ COMMENT : writes
    USER ||--o{ TASK : "assigned"
    TAG ||--o{ ENTITY_TAG : "applied via"
```

Polymorphic links (`entityType` + `entityId`, application-enforced): comments, attachments,
entity_tags, tasks, custom_field_values, favorites, notifications, audit_logs, activity_logs,
workflow_instances → any business entity.
