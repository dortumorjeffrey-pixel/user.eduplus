const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

exports.sendNotificationOnQuestion = functions.firestore
  .document('questions/{questionId}')
  .onCreate(async (snap, context) => {
    const question = snap.data();
    const courseCode = question.courseCode;

    try {
      const lecturersSnap = await admin.firestore().collection('lecturers').get();
      let targetToken = null;

      lecturersSnap.forEach(doc => {
        const data = doc.data();
        if (data.courses && Array.isArray(data.courses)) {
          const teachesCourse = data.courses.some(c => c.courseCode.toUpperCase() === courseCode.toUpperCase());
          if (teachesCourse && data.fcmToken) {
            targetToken = data.fcmToken;
          }
        }
      });

      if (!targetToken) {
        console.log('No FCM token found for lecturer teaching:', courseCode);
        return null;
      }

      const payload = {
        notification: {
          title: `New Question in ${courseCode}`,
          body: question.text.substring(0, 100),
          icon: '/icon.png'
        }
      };

      await admin.messaging().sendToDevice(targetToken, payload);
      console.log('Notification sent successfully to lecturer for course:', courseCode);
    } catch (error) {
      console.error('Error sending notification:', error);
    }
    return null;
  });
