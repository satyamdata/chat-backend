import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { pool } from './db';
import { db } from './firebase';
import { FieldValue } from 'firebase-admin/firestore';

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 3000;

// Welcome route
app.get('/', (req, res) => {
    res.send('Chat Backend is running successfully! 🚀');
});

// ==========================================
// 1. Create or Get Chat (POST /chat/create) [MySQL]
// ==========================================
app.post('/chat/create', async (req: Request, res: Response) => {
    try {
        const body = req.body || {};
        const { userAId, userBId } = body;

        if (!userAId || !userBId) {
            return res.status(400).json({ error: 'userAId and userBId are required' });
        }

        const [rows]: any = await pool.query(
            `SELECT id FROM chats WHERE 
             (user_a_id = ? AND user_b_id = ?) OR 
             (user_a_id = ? AND user_b_id = ?)`,
            [userAId, userBId, userBId, userAId]
        );

        if (rows.length > 0) {
            return res.json({ chatId: rows[0].id.toString() });
        }

        const [result]: any = await pool.query(
            `INSERT INTO chats (user_a_id, user_b_id) VALUES (?, ?)`,
            [userAId, userBId]
        );

        return res.status(201).json({ chatId: result.insertId.toString() });
    } catch (error) {
        console.error('Error creating chat:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// 2. Send Message (POST /chat/:chatId/message/send) [Firestore]
// ==========================================
app.post('/chat/:chatId/message/send', async (req: Request, res: Response) => {
    try {
        const { chatId } = req.params;
        const body = req.body || {};
        const { senderId, text } = body;

        if (!senderId || !text) {
            return res.status(400).json({ error: 'senderId and text are required' });
        }

        const messageRef = await db.collection('chats').doc(chatId).collection('messages').add({
            senderId,
            text,
            read: false,
            timestamp: FieldValue.serverTimestamp()
        });

        return res.status(201).json({ messageId: messageRef.id, status: 'sent' });
    } catch (error) {
        console.error('Error sending message:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// 3. Get Messages (GET /chat/:chatId/messages?limit=50) [Firestore]
// ==========================================
app.get('/chat/:chatId/messages', async (req: Request, res: Response) => {
    try {
        const { chatId } = req.params;
        const limitVal = req.query.limit ? parseInt(req.query.limit as string) : 50;

        const snapshot = await db.collection('chats')
            .doc(chatId)
            .collection('messages')
            .orderBy('timestamp', 'asc')
            .limit(limitVal)
            .get();

        const messages = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));

        return res.json({ messages });
    } catch (error) {
        console.error('Error fetching messages:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// 4. Mark Message Read (POST /chat/:chatId/message/:messageId/read) [Firestore]
// ==========================================
app.post('/chat/:chatId/message/:messageId/read', async (req: Request, res: Response) => {
    try {
        const { chatId, messageId } = req.params;
        const body = req.body || {};
        const { userId } = body;

        const msgRef = db.collection('chats').doc(chatId).collection('messages').doc(messageId);
        await msgRef.update({
            read: true,
            readBy: userId || null
        });

        return res.json({ success: true, message: 'Message marked as read' });
    } catch (error) {
        console.error('Error marking message read:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// 5. Update Last Seen Message (POST /chat/:chatId/lastseen) [Firestore]
// ==========================================
app.post('/chat/:chatId/lastseen', async (req: Request, res: Response) => {
    try {
        const { chatId } = req.params;
        const body = req.body || {};
        const { userId, messageId } = body;

        if (!userId || !messageId) {
            return res.status(400).json({ error: 'userId and messageId are required' });
        }

        await db.collection('chats').doc(chatId).collection('lastSeen').doc(userId.toString()).set({
            messageId,
            updatedAt: FieldValue.serverTimestamp()
        });

        return res.json({ success: true, message: 'Last seen updated' });
    } catch (error) {
        console.error('Error updating last seen:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// 6. List User Chats (GET /user/:userId/chats) [MySQL]
// ==========================================
app.get('/user/:userId/chats', async (req: Request, res: Response) => {
    try {
        const { userId } = req.params;

        const [rows]: any = await pool.query(
            `SELECT * FROM chats WHERE user_a_id = ? OR user_b_id = ?`,
            [userId, userId]
        );

        return res.json({ chats: rows });
    } catch (error) {
        console.error('Error fetching chats:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// 7. BONUS: Create Group Chat (POST /group/create) [MySQL]
// ==========================================
app.post('/group/create', async (req: Request, res: Response) => {
    try {
        const { name, createdBy, memberIds } = req.body;
        if (!name || !createdBy || !memberIds) {
            return res.status(400).json({ error: 'name, createdBy, and memberIds are required' });
        }

        const [groupResult]: any = await pool.query(
            `INSERT INTO groups (name, created_by) VALUES (?, ?)`,
            [name, createdBy]
        );
        const groupId = groupResult.insertId;

        const allMembers = [...new Set([...memberIds, createdBy])];
        const values = allMembers.map((userId) => [groupId, userId]);

        await pool.query(
            `INSERT INTO group_members (group_id, user_id) VALUES ?`,
            [values]
        );

        return res.status(201).json({ groupId: groupId.toString(), name, members: allMembers });
    } catch (error) {
        console.error('Error creating group:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// 8. BONUS: Edit Message (PATCH /chat/:chatId/message/:messageId) [Firestore]
// ==========================================
app.patch('/chat/:chatId/message/:messageId', async (req: Request, res: Response) => {
    try {
        const { chatId, messageId } = req.params;
        const { userId, newText } = req.body;

        if (!userId || !newText) {
            return res.status(400).json({ error: 'userId and newText are required' });
        }

        const msgRef = db.collection('chats').doc(chatId).collection('messages').doc(messageId);
        const doc = await msgRef.get();

        if (!doc.exists) {
            return res.status(404).json({ error: 'Message not found' });
        }

        if (doc.data()?.senderId !== userId) {
            return res.status(403).json({ error: 'Unauthorized to edit this message' });
        }

        await msgRef.update({
            text: newText,
            edited: true,
            updatedAt: FieldValue.serverTimestamp()
        });

        return res.json({ success: true, message: 'Message updated successfully' });
    } catch (error) {
        console.error('Error editing message:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// 9. BONUS: Delete Message (DELETE /chat/:chatId/message/:messageId) [Firestore]
// ==========================================
app.delete('/chat/:chatId/message/:messageId', async (req: Request, res: Response) => {
    try {
        const { chatId, messageId } = req.params;
        const { userId } = req.body;

        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }

        const msgRef = db.collection('chats').doc(chatId).collection('messages').doc(messageId);
        const doc = await msgRef.get();

        if (!doc.exists) {
            return res.status(404).json({ error: 'Message not found' });
        }

        if (doc.data()?.senderId !== userId) {
            return res.status(403).json({ error: 'Unauthorized to delete this message' });
        }

        // Soft delete
        await msgRef.update({
            text: '🚫 This message was deleted',
            isDeleted: true
        });

        return res.json({ success: true, message: 'Message deleted successfully' });
    } catch (error) {
        console.error('Error deleting message:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// Server Start
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});