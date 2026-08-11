export interface paths {
    "/dashboard": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get dashboard summary */
        get: operations["getDashboard"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/products": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List products */
        get: operations["listProducts"];
        put?: never;
        /** Publish a product with Schema XML */
        post: operations["publishProduct"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/products/drafts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Save a product draft with Schema XML */
        post: operations["saveProductDraft"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/products/schema": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Get the product publishing Schema */
        post: operations["getProductSchema"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/products/display": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Update product display state */
        patch: operations["updateProductDisplay"];
        trace?: never;
    };
    "/products/{productId}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                productId: components["parameters"]["ProductId"];
            };
            cookie?: never;
        };
        /** Get a product rendered as Schema XML */
        get: operations["getProduct"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Update a product with Schema XML */
        patch: operations["updateProduct"];
        trace?: never;
    };
    "/photo-groups": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List photo bank groups */
        get: operations["listPhotoGroups"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/photos": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List photo bank images */
        get: operations["listPhotos"];
        put?: never;
        /** Upload a photo bank image */
        post: operations["uploadPhoto"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/orders": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List seller orders */
        get: operations["listOrders"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/orders/{orderId}/fund": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get order fund information */
        get: operations["getOrderFund"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/orders/{orderId}/logistics": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get order logistics information */
        get: operations["getOrderLogistics"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/capabilities": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List audited API capabilities */
        get: operations["listCapabilities"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/gateway/call": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Call an enabled audited capability */
        post: operations["callCapability"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        DashboardSummary: {
            productCount: number;
            photoCount: number;
            pendingOrderCount: number;
            enabledCapabilityCount: number;
        };
        Product: {
            id: string;
            subject: string;
            groupName: string;
            /** @enum {string} */
            status: "online" | "offline" | "draft" | "auditing" | "rejected";
            score: number;
            /** Format: date-time */
            updatedAt: string;
        };
        ProductDetail: components["schemas"]["Product"] & {
            categoryId: number;
            language: string;
            schemaXml: string;
        };
        ProductPage: components["schemas"]["PageMeta"] & {
            items: components["schemas"]["Product"][];
        };
        ProductSchemaRequest: {
            categoryId: number;
            /** @default en_US */
            language: string;
            /** @enum {string} */
            market: "wholesale" | "sourcing";
            productId?: string;
        };
        ProductSchema: {
            xml: string;
            categoryId: number;
            language: string;
            market: string;
        };
        SchemaPublishRequest: {
            categoryId: number;
            /** @default en_US */
            language: string;
            productId?: string;
            schemaXml: string;
        };
        ProductMutationResult: {
            productId: string;
            traceId: string;
            success: boolean;
        };
        PhotoGroup: {
            id: string;
            name: string;
            photoCount: number;
        };
        Photo: {
            id: string;
            name: string;
            /** Format: uri */
            url: string;
            groupId: string;
            width: number;
            height: number;
        };
        PhotoPage: components["schemas"]["PageMeta"] & {
            items: components["schemas"]["Photo"][];
        };
        Order: {
            id: string;
            buyerName: string;
            amount: number;
            currency: string;
            status: string;
            /** Format: date-time */
            createdAt: string;
            /**
             * @description seller.order.get is not callable outside Jushita.
             * @enum {string}
             */
            detailAvailability: "summary_only";
        };
        OrderPage: components["schemas"]["PageMeta"] & {
            items: components["schemas"]["Order"][];
        };
        OrderFund: {
            orderId: string;
            paidAmount: number;
            currency: string;
            status: string;
        };
        OrderLogistics: {
            orderId: string;
            status: string;
            carrier?: string | null;
            trackingNumber?: string | null;
        };
        ApiCapability: {
            method: string;
            domain: string;
            chargeLabel: string;
            /** @enum {string} */
            auth: "required" | "optional" | "none" | "unknown";
            jushitaOnly: boolean;
            restricted: boolean;
            restrictionReason?: string | null;
            enabled: boolean;
            /** Format: uri */
            docUrl: string;
            /** Format: date */
            checkedAt: string;
            /** Format: date */
            updatedAt?: string | null;
        };
        CapabilityCallRequest: {
            method: string;
            parameters: {
                [key: string]: unknown;
            };
        };
        CapabilityCallResult: {
            method: string;
            traceId: string;
            data: unknown;
        };
        GatewayError: {
            code: string;
            message: string;
            subCode?: string;
            traceId?: string;
            retryable: boolean;
        };
        PageMeta: {
            page: number;
            pageSize: number;
            total: number;
        };
    };
    responses: {
        /** @description Gateway failure */
        GatewayFailure: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["GatewayError"];
            };
        };
    };
    parameters: {
        Page: number;
        PageSize: number;
        ProductId: string;
        OrderId: string;
    };
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    getDashboard: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Dashboard summary */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DashboardSummary"];
                };
            };
            default: components["responses"]["GatewayFailure"];
            "4XX": components["responses"]["GatewayFailure"];
        };
    };
    listProducts: {
        parameters: {
            query?: {
                page?: components["parameters"]["Page"];
                pageSize?: components["parameters"]["PageSize"];
                subject?: string;
                groupId?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Product page */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProductPage"];
                };
            };
            default: components["responses"]["GatewayFailure"];
            "4XX": components["responses"]["GatewayFailure"];
        };
    };
    publishProduct: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SchemaPublishRequest"];
            };
        };
        responses: {
            /** @description Published product */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProductMutationResult"];
                };
            };
            default: components["responses"]["GatewayFailure"];
            "4XX": components["responses"]["GatewayFailure"];
        };
    };
    saveProductDraft: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SchemaPublishRequest"];
            };
        };
        responses: {
            /** @description Saved draft */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProductMutationResult"];
                };
            };
            default: components["responses"]["GatewayFailure"];
            "4XX": components["responses"]["GatewayFailure"];
        };
    };
    getProductSchema: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ProductSchemaRequest"];
            };
        };
        responses: {
            /** @description Alibaba schema XML and normalized fields */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProductSchema"];
                };
            };
            default: components["responses"]["GatewayFailure"];
            "4XX": components["responses"]["GatewayFailure"];
        };
    };
    updateProductDisplay: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    productIds: string[];
                    /** @enum {string} */
                    display: "online" | "offline";
                };
            };
        };
        responses: {
            /** @description Updated */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            default: components["responses"]["GatewayFailure"];
            "4XX": components["responses"]["GatewayFailure"];
        };
    };
    getProduct: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                productId: components["parameters"]["ProductId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Product detail */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProductDetail"];
                };
            };
            default: components["responses"]["GatewayFailure"];
            "4XX": components["responses"]["GatewayFailure"];
        };
    };
    updateProduct: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                productId: components["parameters"]["ProductId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SchemaPublishRequest"];
            };
        };
        responses: {
            /** @description Updated product */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProductMutationResult"];
                };
            };
            default: components["responses"]["GatewayFailure"];
            "4XX": components["responses"]["GatewayFailure"];
        };
    };
    listPhotoGroups: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Photo groups */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PhotoGroup"][];
                };
            };
            default: components["responses"]["GatewayFailure"];
            "4XX": components["responses"]["GatewayFailure"];
        };
    };
    listPhotos: {
        parameters: {
            query?: {
                page?: components["parameters"]["Page"];
                pageSize?: components["parameters"]["PageSize"];
                groupId?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Photo page */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PhotoPage"];
                };
            };
            default: components["responses"]["GatewayFailure"];
            "4XX": components["responses"]["GatewayFailure"];
        };
    };
    uploadPhoto: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": {
                    file: string;
                    fileName: string;
                    /** @default -1 */
                    groupId?: string;
                };
            };
        };
        responses: {
            /** @description Uploaded photo */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Photo"];
                };
            };
            default: components["responses"]["GatewayFailure"];
            "4XX": components["responses"]["GatewayFailure"];
        };
    };
    listOrders: {
        parameters: {
            query?: {
                page?: components["parameters"]["Page"];
                pageSize?: components["parameters"]["PageSize"];
                status?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Order page */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OrderPage"];
                };
            };
            default: components["responses"]["GatewayFailure"];
            "4XX": components["responses"]["GatewayFailure"];
        };
    };
    getOrderFund: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                orderId: components["parameters"]["OrderId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Order fund information */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OrderFund"];
                };
            };
            default: components["responses"]["GatewayFailure"];
            "4XX": components["responses"]["GatewayFailure"];
        };
    };
    getOrderLogistics: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                orderId: components["parameters"]["OrderId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Order logistics information */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OrderLogistics"];
                };
            };
            default: components["responses"]["GatewayFailure"];
            "4XX": components["responses"]["GatewayFailure"];
        };
    };
    listCapabilities: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Audited Alibaba API capabilities */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiCapability"][];
                };
            };
            default: components["responses"]["GatewayFailure"];
            "4XX": components["responses"]["GatewayFailure"];
        };
    };
    callCapability: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CapabilityCallRequest"];
            };
        };
        responses: {
            /** @description Normalized gateway result */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CapabilityCallResult"];
                };
            };
            default: components["responses"]["GatewayFailure"];
            "4XX": components["responses"]["GatewayFailure"];
        };
    };
}
