/**
 * @swagger
 * /health:
 *   get:
 *     summary: Health check endpoint
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Service is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: healthy
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                 version:
 *                   type: string
 *                 uptime:
 *                   type: number
 *                 checks:
 *                   type: object
 *                   properties:
 *                     database:
 *                       type: object
 *                     redis:
 *                       type: object
 *                     memory:
 *                       type: object
 *                     cpu:
 *                       type: object
 * 
 * /health/ready:
 *   get:
 *     summary: Readiness probe for Kubernetes
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Service is ready
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ready:
 *                   type: boolean
 * 
 * /health/live:
 *   get:
 *     summary: Liveness probe for Kubernetes
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Service is alive
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 alive:
 *                   type: boolean
 * 
 * /health/metrics:
 *   get:
 *     summary: Prometheus metrics endpoint
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Prometheus-formatted metrics
 *         content:
 *           text/plain:
 *             schema:
 *               type: string
 * 
 * /health/circuit-breakers:
 *   get:
 *     summary: Get circuit breaker states
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Circuit breaker status
 * 
 * /health/circuit-breakers/{name}/reset:
 *   post:
 *     summary: Reset a circuit breaker manually
 *     tags: [Health]
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Circuit breaker reset
 */

/**
 * @swagger
 * /api/business/me:
 *   get:
 *     summary: Get current business profile
 *     tags: [Business]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Business profile retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                 name:
 *                   type: string
 *                 email:
 *                   type: string
 *                 phone:
 *                   type: string
 *                 industry:
 *                   type: string
 *                 active:
 *                   type: boolean
 *                 apiKey:
 *                   type: string
 *                 createdAt:
 *                   type: string
 *                   format: date-time
 *       401:
 *         description: Unauthorized
 *   put:
 *     summary: Update business profile
 *     tags: [Business]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               email:
 *                 type: string
 *               phone:
 *                 type: string
 *               industry:
 *                 type: string
 *     responses:
 *       200:
 *         description: Business profile updated
 */

/**
 * @swagger
 * /api/business/ai-config:
 *   get:
 *     summary: Get AI configuration
 *     tags: [Business]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: AI configuration retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 customPrompt:
 *                   type: string
 *                 tone:
 *                   type: string
 *                   enum: [professional, friendly, casual, formal]
 *                 language:
 *                   type: string
 *                 fallbackMessage:
 *                   type: string
 *                 maxTokens:
 *                   type: integer
 *                 temperature:
 *                   type: number
 *   put:
 *     summary: Update AI configuration
 *     tags: [Business]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               customPrompt:
 *                 type: string
 *               tone:
 *                 type: string
 *                 enum: [professional, friendly, casual, formal]
 *               language:
 *                 type: string
 *               fallbackMessage:
 *                 type: string
 *               prohibitedTopics:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: AI configuration updated
 */

/**
 * @swagger
 * /api/business/credits:
 *   get:
 *     summary: Get credit balance and usage
 *     tags: [Business]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Credit information retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 totalCredits:
 *                   type: number
 *                 usedCredits:
 *                   type: number
 *                 availableCredits:
 *                   type: number
 *                 monthlyBudget:
 *                   type: number
 *                 currentMonthSpend:
 *                   type: number
 *                 percentUsed:
 *                   type: integer
 *                 isPaused:
 *                   type: boolean
 *                 planType:
 *                   type: string
 * 
 * /api/business/plan:
 *   put:
 *     summary: Upgrade or downgrade subscription plan
 *     tags: [Business]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               planType:
 *                 type: string
 *                 enum: [STARTER, PRO, ENTERPRISE]
 *     responses:
 *       200:
 *         description: Plan updated successfully
 */

/**
 * @swagger
 * /api/customers:
 *   get:
 *     summary: List customers with pagination and filters
 *     tags: [Customers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by name, email, or phone
 *       - in: query
 *         name: verified
 *         schema:
 *           type: boolean
 *       - in: query
 *         name: tags
 *         schema:
 *           type: string
 *         description: Comma-separated tags
 *     responses:
 *       200:
 *         description: List of customers
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       name:
 *                         type: string
 *                       email:
 *                         type: string
 *                       phone:
 *                         type: string
 *                       trustScore:
 *                         type: integer
 *                       isVerified:
 *                         type: boolean
 *                       tags:
 *                         type: array
 *                         items:
 *                           type: string
 *                 pagination:
 *                   type: object
 *   post:
 *     summary: Create new customer
 *     tags: [Customers]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *               email:
 *                 type: string
 *               phone:
 *                 type: string
 *               metadata:
 *                 type: object
 *               tags:
 *                 type: array
 *                 items:
 *                   type: string
 *               preferences:
 *                 type: object
 *     responses:
 *       201:
 *         description: Customer created
 */

/**
 * @swagger
 * /api/customers/{id}:
 *   get:
 *     summary: Get customer details
 *     tags: [Customers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Customer details
 *       404:
 *         description: Customer not found
 *   put:
 *     summary: Update customer
 *     tags: [Customers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               email:
 *                 type: string
 *               phone:
 *                 type: string
 *               metadata:
 *                 type: object
 *               tags:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Customer updated
 *   delete:
 *     summary: Delete customer and all data
 *     tags: [Customers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       204:
 *         description: Customer deleted
 */

/**
 * @swagger
 * /api/customers/{id}/conversations:
 *   get:
 *     summary: Get customer conversation history
 *     tags: [Customers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: List of conversations
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       channel:
 *                         type: string
 *                       status:
 *                         type: string
 *                       messageCount:
 *                         type: integer
 *                       startedAt:
 *                         type: string
 *                         format: date-time
 *                       summary:
 *                         type: string
 * 
 * /api/customers/{id}/metrics:
 *   get:
 *     summary: Get customer metrics and analytics
 *     tags: [Customers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Customer metrics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 totalConversations:
 *                   type: integer
 *                 totalMessages:
 *                   type: integer
 *                 avgResponseTime:
 *                   type: number
 *                 lastInteraction:
 *                   type: string
 *                   format: date-time
 * 
 * /api/customers/{id}/tags:
 *   post:
 *     summary: Add tags to customer
 *     tags: [Customers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               tags:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Tags added
 *   delete:
 *     summary: Remove tags from customer
 *     tags: [Customers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               tags:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Tags removed
 * 
 * /api/customers/{id}/verify:
 *   post:
 *     summary: Verify customer phone/email
 *     tags: [Customers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Customer verified
 * 
 * /api/customers/{id}/block:
 *   post:
 *     summary: Block or unblock customer
 *     tags: [Customers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               blocked:
 *                 type: boolean
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Block status updated
 */

/**
 * @swagger
 * /api/conversations:
 *   get:
 *     summary: List conversations with filters
 *     tags: [Conversations]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [ACTIVE, CLOSED, TRANSFERRED]
 *       - in: query
 *         name: channel
 *         schema:
 *           type: string
 *           enum: [VOICE, CHAT, EMAIL, SMS, WHATSAPP, TELEGRAM, INSTAGRAM]
 *       - in: query
 *         name: customerId
 *         schema:
 *           type: string
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: List of conversations
 *   post:
 *     summary: Create new conversation
 *     tags: [Conversations]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               customerId:
 *                 type: string
 *               channel:
 *                 type: string
 *               metadata:
 *                 type: object
 *     responses:
 *       201:
 *         description: Conversation created
 */

/**
 * @swagger
 * /api/conversations/{id}:
 *   get:
 *     summary: Get conversation details
 *     tags: [Conversations]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Conversation details
 */

/**
 * @swagger
 * /api/conversations/{id}/messages:
 *   get:
 *     summary: Get conversation messages
 *     tags: [Conversations]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: List of messages
 *   post:
 *     summary: Send message to conversation
 *     tags: [Conversations]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               content:
 *                 type: string
 *               role:
 *                 type: string
 *                 enum: [USER, ASSISTANT, SYSTEM]
 *     responses:
 *       201:
 *         description: Message sent
 */

/**
 * @swagger
 * /api/conversations/{id}/close:
 *   post:
 *     summary: Close conversation
 *     tags: [Conversations]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
 *               summary:
 *                 type: string
 *     responses:
 *       200:
 *         description: Conversation closed
 * 
 * /api/conversations/{id}/transfer:
 *   post:
 *     summary: Transfer conversation to human agent
 *     tags: [Conversations]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               agentId:
 *                 type: string
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Conversation transferred
 */

/**
 * @swagger
 * /api/campaigns:
 *   get:
 *     summary: List campaigns
 *     tags: [Campaigns]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: List of campaigns
 *   post:
 *     summary: Create new campaign
 *     tags: [Campaigns]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               type:
 *                 type: string
 *                 enum: [REMINDER, PROMOTION, FOLLOW_UP, ABANDONED_CART]
 *               channel:
 *                 type: string
 *               messageTemplate:
 *                 type: string
 *               scheduledAt:
 *                 type: string
 *                 format: date-time
 *               targetFilter:
 *                 type: object
 *     responses:
 *       201:
 *         description: Campaign created
 */

/**
 * @swagger
 * /api/campaigns/{id}:
 *   get:
 *     summary: Get campaign details
 *     tags: [Campaigns]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Campaign details
 *   put:
 *     summary: Update campaign
 *     tags: [Campaigns]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Campaign updated
 *   delete:
 *     summary: Delete campaign
 *     tags: [Campaigns]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       204:
 *         description: Campaign deleted
 */

/**
 * @swagger
 * /api/campaigns/{id}/execute:
 *   post:
 *     summary: Execute campaign immediately
 *     tags: [Campaigns]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Campaign execution started
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 campaignId:
 *                   type: string
 *                 status:
 *                   type: string
 *                 targeted:
 *                   type: integer
 * 
 * /api/campaigns/{id}/stats:
 *   get:
 *     summary: Get campaign statistics
 *     tags: [Campaigns]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Campaign statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 totalSent:
 *                   type: integer
 *                 totalFailed:
 *                   type: integer
 *                 totalReplied:
 *                   type: integer
 *                 totalConverted:
 *                   type: integer
 */

export {};
