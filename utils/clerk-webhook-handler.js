import User from "../models/user.js";

// Fungsi untuk menangani webhook dari Clerk
const handleClerkWebhook = async (eventType, data) => {
  try {
    switch (eventType) {
      case 'user.created': {
        const { id, email_addresses, first_name, last_name, image_url, primary_email_address_id } = data;
        const primaryEmail = (email_addresses || []).find(email => email.id === primary_email_address_id);

        const newUser = new User({
          clerkId: id,
          email: primaryEmail ? primaryEmail.email_address : '',
          firstName: first_name || '',
          lastName: last_name || '',
          profileImage: image_url || ''
        });

        await newUser.save();
        console.log(`✅ User baru dibuat: ${id}`);
        break;
      }

      case 'user.updated': {
        const { id, email_addresses, first_name, last_name, image_url, primary_email_address_id } = data;
        const primaryEmail = (email_addresses || []).find(email => email.id === primary_email_address_id);

        const user = await User.findOne({ clerkId: id });
        if (user) {
          user.email = primaryEmail ? primaryEmail.email_address : user.email;
          user.firstName = first_name || user.firstName;
          user.lastName = last_name || user.lastName;
          user.profileImage = image_url || user.profileImage;
          user.updatedAt = new Date();

          await user.save();
          console.log(`🔄 User diupdate: ${id}`);
        }
        break;
      }

      case 'user.deleted': {
        const { id } = data;
        await User.findOneAndDelete({ clerkId: id });
        console.log(`🗑️ User dihapus: ${id}`);
        break;
      }

      default:
        console.log(`⚠️ Event tidak ditangani: ${eventType}`);
    }
  } catch (error) {
    console.error(`❌ Error menangani webhook ${eventType}:`, error?.message || error);
  }
};

export { handleClerkWebhook };
